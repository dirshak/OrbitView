"""OrbitView ML service: re-entry forecasts + Groq-powered assistant."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .assistant import Assistant, GroqNotConfigured, GroqRateLimited
from .reentry import ReentryPredictor
from .telemetry import TelemetryReplay

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ml-service")

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:5080")
REFRESH_SECONDS = 6 * 3600
METRICS_PATH = Path(__file__).resolve().parents[1] / "models" / "metrics.json"


class State:
    client: httpx.AsyncClient
    predictor: ReentryPredictor
    assistant: Assistant
    telemetry: TelemetryReplay
    catalog: list[dict] = []


state = State()


async def refresh_loop() -> None:
    while True:
        try:
            # Score straight away with the bundled reference data, then rescore
            # once fresh SATCAT / solar-flux data has downloaded (can take minutes).
            r = await state.client.get(f"{BACKEND_URL}/api/satellites", timeout=60)
            r.raise_for_status()
            catalog = r.json()
            if not catalog:
                # Backend hasn't loaded TLEs yet (fresh database or CelesTrak unreachable).
                log.warning("backend catalogue is empty; retrying in 60s")
                await asyncio.sleep(60)
                continue
            state.catalog = catalog
            # Scoring the whole catalogue takes seconds of CPU; run it in a worker
            # thread so requests keep being served meanwhile.
            await asyncio.to_thread(state.predictor.score, state.catalog)
            await state.predictor.refresh_reference_data(state.client)
            await asyncio.to_thread(state.predictor.score, state.catalog)
            await asyncio.sleep(REFRESH_SECONDS)
        except Exception as exc:  # noqa: BLE001 — backend may still be starting
            log.warning("refresh failed (%s); retrying in 30s", exc)
            await asyncio.sleep(30)


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.client = httpx.AsyncClient(headers={"User-Agent": "OrbitView-ML/1.0"})
    state.predictor = ReentryPredictor()
    state.assistant = Assistant(BACKEND_URL, state.predictor, lambda: state.catalog)
    state.telemetry = TelemetryReplay()
    task = asyncio.create_task(refresh_loop())
    yield
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    await state.client.aclose()


app = FastAPI(title="OrbitView ML service", lifespan=lifespan)


@app.get("/ml/health")
def health() -> dict:
    return {
        "status": "ok",
        "catalogSize": len(state.catalog),
        "scoredObjects": len(state.predictor.forecasts),
        "scoredAt": state.predictor.scored_at,
        "assistantConfigured": state.assistant.configured,
        "assistantModel": state.assistant.model,
    }


@app.get("/ml/reentry/model-card")
def model_card() -> dict:
    return json.loads(METRICS_PATH.read_text())


@app.get("/ml/reentry")
def upcoming(within_days: int = 365, limit: int = 50, include_station_kept: bool = False) -> dict:
    days = min(max(within_days, 1), 365)
    return {
        "scoredAt": state.predictor.scored_at,
        "stationKeptExcluded": 0 if include_station_kept else state.predictor.station_kept_count(days),
        "items": state.predictor.upcoming(days, min(max(limit, 1), 200), include_station_kept),
    }


@app.get("/ml/reentry/{norad_id}")
def forecast(norad_id: int) -> dict:
    if state.predictor.scored_at is None:
        raise HTTPException(503, "Forecasts are still being computed")
    result = state.predictor.get(norad_id)
    if result is None:
        raise HTTPException(404, "Satellite not in the live catalogue")
    return result


@app.get("/ml/telemetry/summary")
def telemetry_summary() -> dict:
    """Spacecraft Health dashboard: detection metrics and per-channel results."""
    return state.telemetry.summary()


@app.get("/ml/telemetry/channels/{key}")
def telemetry_channel(key: str, points: int = 1200) -> dict:
    result = state.telemetry.channel(key, points)
    if result is None:
        raise HTTPException(404, "Unknown telemetry channel")
    return result


class TleIn(BaseModel):
    tleLine1: str = Field(min_length=69, max_length=69)
    tleLine2: str = Field(min_length=69, max_length=69)
    name: str = "UNKNOWN"
    noradId: int | None = None


class PredictRequest(BaseModel):
    satellites: list[TleIn] = Field(min_length=1, max_length=20000)


@app.post("/ml/reentry/predict")
def predict(req: PredictRequest) -> dict:
    """Score arbitrary TLEs with the re-entry models (one or a batch)."""
    items = [
        {
            "noradId": s.noradId if s.noradId is not None else int(s.tleLine1[2:7]),
            "name": s.name,
            "tleLine1": s.tleLine1,
            "tleLine2": s.tleLine2,
        }
        for s in req.satellites
    ]
    forecasts, ineligible = state.predictor.forecast(items)
    results = []
    for item in items:
        nid = item["noradId"]
        if nid in forecasts:
            results.append(forecasts[nid].to_dict())
        elif nid in ineligible:
            results.append({"noradId": nid, "eligible": False, "reason": ineligible[nid]})
        else:
            results.append({"noradId": nid, "eligible": False, "reason": "Could not parse TLE"})
    return {"count": len(results), "results": results}


class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=40)
    context: dict = Field(default_factory=dict)


@app.post("/ml/assistant/chat")
async def chat(req: ChatRequest) -> dict:
    try:
        return await state.assistant.chat(
            state.client, [m.model_dump() for m in req.messages], req.context
        )
    except GroqNotConfigured:
        raise HTTPException(503, "The assistant needs a Groq API key: set GROQ_API_KEY in .env and restart.")
    except GroqRateLimited as exc:
        raise HTTPException(
            429,
            f"The Groq free tier allows a limited number of tokens per minute and it's used up. "
            f"Try again in about {max(5, round(exc.retry_after))} seconds.",
        )
    except RuntimeError as exc:
        log.warning("assistant failed: %s", exc)
        raise HTTPException(502, str(exc))
