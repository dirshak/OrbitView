"""Natural-language assistant: Groq LLM + tool calls into OrbitView's own data."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from .features import parse_tle, perigee_apogee_km
from .reentry import ReentryPredictor

log = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
MAX_TOOL_ROUNDS = 6
MAX_HISTORY = 12
MAX_MESSAGE_CHARS = 2000
# Groq's free tier allows a few thousand tokens per minute; wait out short limits.
MAX_RATE_LIMIT_WAIT_S = 20.0
RATE_LIMIT_RETRIES = 2
# Fields the model needs from a re-entry forecast (keeps tool results small).
FORECAST_FIELDS = (
    "noradId", "name", "eligible", "reason", "perigeeKm", "probabilityWithinYear", "likelyWithinYear",
    "stationKept", "daysP50", "predictedDate", "windowStart", "windowEnd",
)

# Common names that don't match catalogue names.
ALIASES = {
    "tiangong": "css",
    "chinese space station": "css",
    "china space station": "css",
    "tianhe": "css",
    "hubble": "hst",
    "international space station": "iss",
}

CATEGORIES = ["iss", "earth-observation", "weather", "communication", "science", "navigation", "cubesat", "other"]

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "search_satellites",
            "description": "Find satellites in the live catalogue by (partial) name or NORAD id, optionally filtered by category.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Name fragment (e.g. 'ISS', 'NOAA 19', 'Cartosat') or NORAD id. May be empty when filtering by category."},
                    "category": {"type": "string", "enum": CATEGORIES},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_satellite_details",
            "description": "Orbit summary for one satellite: category, perigee/apogee altitude, inclination, period, and TLE epoch.",
            "parameters": {
                "type": "object",
                "properties": {"norad_id": {"type": "integer"}},
                "required": ["norad_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_current_position",
            "description": "Current sub-satellite latitude/longitude, altitude (km) and speed (km/s).",
            "parameters": {
                "type": "object",
                "properties": {"norad_id": {"type": "integer"}},
                "required": ["norad_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "predict_passes",
            "description": "Upcoming passes of a satellite above the horizon for an observer location. Times are UTC ISO-8601.",
            "parameters": {
                "type": "object",
                "properties": {
                    "norad_id": {"type": "integer"},
                    "latitude": {"type": "number", "description": "Observer latitude in degrees (north positive)."},
                    "longitude": {"type": "number", "description": "Observer longitude in degrees (east positive)."},
                    "hours": {"type": "integer", "minimum": 1, "maximum": 168, "default": 72},
                    "max_passes": {"type": "integer", "minimum": 1, "maximum": 10, "default": 5},
                },
                "required": ["norad_id", "latitude", "longitude"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_reentry_forecast",
            "description": "Machine-learning re-entry forecast for one satellite: probability of re-entering within a year and, if likely, predicted date with an 80% window.",
            "parameters": {
                "type": "object",
                "properties": {"norad_id": {"type": "integer"}},
                "required": ["norad_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_upcoming_reentries",
            "description": "Objects the ML model expects to re-enter soonest (excludes actively station-kept satellites such as operational Starlinks).",
            "parameters": {
                "type": "object",
                "properties": {
                    "within_days": {"type": "integer", "minimum": 1, "maximum": 365, "default": 30},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_missions",
            "description": "Curated NASA/NOAA mission profiles available in the Mission Explorer.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
]


class GroqNotConfigured(RuntimeError):
    pass


class GroqRateLimited(RuntimeError):
    def __init__(self, retry_after: float) -> None:
        super().__init__(f"Groq rate limit reached; retry in {retry_after:.0f}s")
        self.retry_after = retry_after


class Assistant:
    def __init__(self, backend_url: str, predictor: ReentryPredictor, catalog: Callable[[], list[dict]]) -> None:
        self.backend_url = backend_url.rstrip("/")
        self.predictor = predictor
        self.catalog = catalog
        self.api_key = os.environ.get("GROQ_API_KEY", "").strip()
        self.model = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def chat(self, client: httpx.AsyncClient, history: list[dict], context: dict) -> dict:
        if not self.configured:
            raise GroqNotConfigured("GROQ_API_KEY is not set")

        messages: list[dict[str, Any]] = [{"role": "system", "content": self._system_prompt(context)}]
        for m in history[-MAX_HISTORY:]:
            if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str):
                messages.append({"role": m["role"], "content": m["content"][:MAX_MESSAGE_CHARS]})

        mentioned: dict[int, str] = {}
        tools_used: list[str] = []
        for _ in range(MAX_TOOL_ROUNDS):
            reply = await self._complete(client, messages)
            calls = reply.get("tool_calls") or []
            if not calls:
                text = reply.get("content") or ""
                return {"reply": text, "satellites": _referenced(text, mentioned), "toolsUsed": tools_used}
            messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
            for call in calls:
                name = call["function"]["name"]
                tools_used.append(name)
                try:
                    args = json.loads(call["function"].get("arguments") or "{}")
                    result = await self._run_tool(client, name, args, mentioned, _zone(context))
                except Exception as exc:  # noqa: BLE001 — surface tool errors to the model
                    log.warning("tool %s failed: %s", name, exc)
                    result = {"error": str(exc)}
                messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "name": name,
                    "content": json.dumps(result, default=str)[:12000],
                })
        # Out of tool rounds: ask for a best-effort answer from what was gathered.
        messages.append({
            "role": "user",
            "content": "Stop using tools now and answer as well as you can with the information gathered so far.",
        })
        reply = await self._complete(client, messages, allow_tools=False)
        text = reply.get("content") or "Sorry — I couldn't complete that. Try a more specific question."
        return {"reply": text, "satellites": _referenced(text, mentioned), "toolsUsed": tools_used}

    async def _complete(self, client: httpx.AsyncClient, messages: list[dict], allow_tools: bool = True) -> dict:
        for attempt in range(RATE_LIMIT_RETRIES + 1):
            r = await client.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": messages,
                    "tools": TOOLS,
                    "tool_choice": "auto" if allow_tools else "none",
                    "temperature": 0.2,
                    "max_completion_tokens": 1200,
                },
                timeout=60,
            )
            if r.status_code == 429:
                wait = _retry_after(r)
                if wait > MAX_RATE_LIMIT_WAIT_S or attempt == RATE_LIMIT_RETRIES:
                    raise GroqRateLimited(wait)
                log.info("Groq rate limited; retrying in %.1fs", wait)
                await asyncio.sleep(wait + 0.5)
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"Groq API error {r.status_code}: {r.text[:300]}")
            return r.json()["choices"][0]["message"]
        raise AssertionError("unreachable")

    def _system_prompt(self, context: dict) -> str:
        zone = _zone(context)
        now = _local(datetime.now(timezone.utc), zone)
        loc = context.get("location")
        loc_line = (
            f"The user's saved observer location is {loc.get('label')} "
            f"(lat {loc.get('latitudeDeg')}, lon {loc.get('longitudeDeg')})."
            if isinstance(loc, dict) and "latitudeDeg" in loc
            else "No saved observer location; default to Mumbai (lat 19.076, lon 72.8777) if one is needed and not given."
        )
        selected = context.get("selectedNoradId")
        sel_line = f"The satellite currently selected on the globe has NORAD id {selected}." if selected else ""
        return (
            "You are the assistant inside OrbitView, a live 3D satellite tracker. "
            "Answer questions about satellites, passes, orbits and re-entries using the tools — never invent "
            "positions, pass times or forecasts. Look satellites up with search_satellites before using a NORAD id "
            "you are unsure of. For named cities, use their well-known coordinates. "
            f"The current local time is {now} ({zone.key}). Tool results include ready-formatted local times "
            "(fields ending in _local); quote those exactly and never convert or compute dates or weekdays yourself. "
            "List passes in time order. Don't speculate about whether the sky is dark or the satellite is sunlit. "
            "Passes with max elevation above ~30° are good; under ~10° are hard to see. "
            "Re-entry forecasts come from OrbitView's gradient-boosting models trained on 2019–2026 Space-Track "
            "history; give the predicted date with its window and say it's a statistical estimate that ignores "
            "manoeuvres. If a forecast has stationKept=true, explain the satellite actively holds its orbit, so the "
            "date only applies if it stopped manoeuvring. Always mention satellites by name together with their NORAD id, like 'ISS (ZARYA) #25544'. "
            f"Be concise: short paragraphs or bullet lists, no tables. {loc_line} {sel_line}"
        )

    async def _run_tool(
        self, client: httpx.AsyncClient, name: str, args: dict, mentioned: dict[int, str], zone: ZoneInfo
    ) -> Any:
        if name == "search_satellites":
            q = str(args.get("query", "")).strip().lower()
            q = ALIASES.get(q, q)
            cat = args.get("category")
            limit = int(args.get("limit") or 10)
            pool = [s for s in self.catalog() if not cat or s.get("category") == cat]
            hits = [s for s in pool if not q or q in s["name"].lower() or q == str(s["noradId"])]
            if not hits and q:
                # Fall back to matching every word, e.g. "noaa 19" -> "NOAA 19 (...)".
                words = q.split()
                hits = [s for s in pool if all(w in s["name"].lower() for w in words)]
            hits.sort(key=lambda s: (not s["name"].lower().startswith(q), len(s["name"])))
            for s in hits[:limit]:
                mentioned[s["noradId"]] = s["name"]
            if not hits:
                return {
                    "total_matches": 0,
                    "results": [],
                    "hint": "No match. Try a shorter name fragment or a NORAD id; catalogue names are official "
                    "designations (e.g. 'CSS (TIANHE)' for Tiangong, 'HST' for Hubble).",
                }
            return {
                "total_matches": len(hits),
                "results": [
                    {"norad_id": s["noradId"], "name": s["name"], "category": s.get("category"), "orbit": s.get("orbitType")}
                    for s in hits[:limit]
                ],
            }

        if name == "list_missions":
            r = await client.get(f"{self.backend_url}/api/missions", timeout=15)
            r.raise_for_status()
            return [{"name": m["name"], "agency": m["agency"], "norad_id": m.get("noradId"), "summary": m["description"][:240]} for m in r.json()]

        if name == "list_upcoming_reentries":
            items = self.predictor.upcoming(int(args.get("within_days") or 30), int(args.get("limit") or 10))
            for f in items:
                mentioned[f["noradId"]] = f["name"]
            return {"count": len(items), "forecasts": [_compact(f) for f in items]}

        norad = int(args["norad_id"])
        sat = next((s for s in self.catalog() if s["noradId"] == norad), None)
        if sat:
            mentioned[norad] = sat["name"]

        if name == "get_satellite_details":
            if not sat:
                return {"error": f"NORAD {norad} is not in the live catalogue"}
            el = parse_tle(sat["tleLine1"], sat["tleLine2"])
            perigee, apogee = perigee_apogee_km(el.mean_motion, el.eccentricity)
            return {
                "norad_id": norad,
                "name": sat["name"],
                "category": sat.get("category"),
                "orbit_type": sat.get("orbitType"),
                "perigee_km": round(float(perigee), 1),
                "apogee_km": round(float(apogee), 1),
                "inclination_deg": el.inclination,
                "period_min": round(1440 / el.mean_motion, 2),
                "operator": sat.get("operator"),
            }
        if name == "get_current_position":
            r = await client.get(f"{self.backend_url}/api/satellites/{norad}/position", timeout=15)
            r.raise_for_status()
            return r.json()
        if name == "predict_passes":
            params = {
                "lat": args["latitude"],
                "lon": args["longitude"],
                "hours": int(args.get("hours") or 72),
                "maxPasses": int(args.get("max_passes") or 5),
            }
            r = await client.get(f"{self.backend_url}/api/satellites/{norad}/passes", params=params, timeout=30)
            r.raise_for_status()
            passes = sorted(r.json(), key=lambda p: p["startTime"])
            for p in passes:
                for key in ("startTime", "peakTime", "endTime"):
                    p[key.replace("Time", "_local")] = _local(_parse_iso(p[key]), zone)
                p["maxElevationDeg"] = round(p["maxElevationDeg"], 1)
            return {"norad_id": norad, "name": sat["name"] if sat else None, "passes": passes}
        if name == "get_reentry_forecast":
            forecast = self.predictor.get(norad)
            return _compact(forecast) if forecast else {"error": f"No forecast for NORAD {norad} (not in the live catalogue)"}
        raise ValueError(f"Unknown tool {name}")


def _retry_after(r: httpx.Response) -> float:
    """Seconds Groq asks us to wait, from the Retry-After header or the error text."""
    try:
        return float(r.headers["retry-after"])
    except (KeyError, ValueError):
        pass
    m = re.search(r"try again in (?:(\d+)m)?([\d.]+)s", r.text)
    if m:
        return int(m.group(1) or 0) * 60 + float(m.group(2))
    return 60.0


def _compact(forecast: dict) -> dict:
    return {k: v for k, v in forecast.items() if k in FORECAST_FIELDS}


def _zone(context: dict) -> ZoneInfo:
    try:
        return ZoneInfo(str(context.get("timezone") or "Asia/Kolkata"))
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("Asia/Kolkata")


def _parse_iso(value: str) -> datetime:
    # .NET emits 7 fractional digits; Python accepts at most 6.
    head, _, rest = value.partition(".")
    if rest:
        n = len(rest) - len(rest.lstrip("0123456789"))
        digits, tz = rest[:n], rest[n:]
        value = f"{head}.{digits[:6]}{tz}"
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _local(moment: datetime, zone: ZoneInfo) -> str:
    """e.g. 'Sun 11 Oct 2026, 16:32 IST'."""
    return moment.astimezone(zone).strftime("%a %d %b %Y, %H:%M %Z")


def _referenced(text: str, mentioned: dict[int, str]) -> list[dict]:
    """Satellites from tool results that the final answer actually talks about."""
    lowered = text.lower()
    return [
        {"noradId": nid, "name": name}
        for nid, name in mentioned.items()
        if str(nid) in text or name.lower() in lowered
    ][:8]
