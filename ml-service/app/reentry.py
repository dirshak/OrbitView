"""Scores the live catalogue with the trained re-entry models."""

from __future__ import annotations

import asyncio
import csv
import gzip
import io
import logging
import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import joblib
import numpy as np

from .features import (
    MAX_PERIGEE_KM,
    MIN_MEAN_MOTION,
    OBJECT_TYPES,
    build_matrix,
    parse_tle,
    perigee_apogee_km,
)

log = logging.getLogger(__name__)

MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "reentry.joblib"
SATCAT_SNAPSHOT = MODEL_PATH.with_name("satcat_snapshot.csv.gz")
SATCAT_URL = "https://celestrak.org/pub/satcat.csv"
SPACE_WEATHER_URL = "https://celestrak.org/SpaceData/SW-Last5Years.csv"
# Below this probability we only say "not expected within a year".
LIKELY_THRESHOLD = 0.5
# Operational members of these constellations hold altitude with thrusters, as
# do crewed stations. Training labels can't reflect that (e.g. Starlink's 2026
# move to ~480 km), so their forecasts are flagged and kept off the watch list.
STATION_KEEPING_NAMES = ("STARLINK", "ONEWEB", "KUIPER")
CREWED_STATIONS = {25544, 48274}  # ISS, Tiangong (Tianhe core)
STATION_KEEPING_MIN_PERIGEE_KM = 340.0  # Starlink runs a ~350-360 km shell


@dataclass
class Forecast:
    norad_id: int
    name: str
    perigee_km: float
    apogee_km: float
    probability_1y: float
    station_kept: bool
    days_p10: float | None
    days_p50: float | None
    days_p90: float | None
    tle_epoch: datetime

    def to_dict(self) -> dict:
        likely = self.probability_1y >= LIKELY_THRESHOLD
        out = {
            "noradId": self.norad_id,
            "name": self.name,
            "eligible": True,
            "perigeeKm": round(self.perigee_km, 1),
            "apogeeKm": round(self.apogee_km, 1),
            "probabilityWithinYear": round(self.probability_1y, 3),
            "likelyWithinYear": likely,
            "stationKept": self.station_kept,
            "tleEpoch": self.tle_epoch.isoformat(),
        }
        if likely and self.days_p50 is not None:
            out |= {
                "daysP10": round(self.days_p10, 1),
                "daysP50": round(self.days_p50, 1),
                "daysP90": round(self.days_p90, 1),
                "predictedDate": (self.tle_epoch + timedelta(days=self.days_p50)).date().isoformat(),
                "windowStart": (self.tle_epoch + timedelta(days=self.days_p10)).date().isoformat(),
                "windowEnd": (self.tle_epoch + timedelta(days=self.days_p90)).date().isoformat(),
            }
        return out


class ReentryPredictor:
    def __init__(self) -> None:
        bundle = joblib.load(MODEL_PATH)
        self.classifier = bundle["classifier"]
        self.quantiles = bundle["quantiles"]
        self.conformal_margin = float(bundle.get("conformal_margin", 0.0))
        self.f107 = dict(bundle["f107_fallback"])
        self.satcat: dict[int, dict] = {}
        if SATCAT_SNAPSHOT.exists():
            with gzip.open(SATCAT_SNAPSHOT, "rt", encoding="utf-8") as fh:
                self.satcat = _parse_satcat(fh.read())
        self.forecasts: dict[int, Forecast] = {}
        self.ineligible: dict[int, str] = {}
        self.scored_at: datetime | None = None

    async def refresh_reference_data(self, client: httpx.AsyncClient) -> None:
        """Catalogue metadata and solar flux; failures keep the previous/fallback values."""
        try:
            r = await client.get(SATCAT_URL, timeout=60)
            r.raise_for_status()
            # Parsing ~70k rows is CPU work; keep it off the event loop.
            self.satcat = await asyncio.to_thread(_parse_satcat, r.text)
            log.info("SATCAT loaded: %d objects", len(self.satcat))
        except Exception as exc:  # noqa: BLE001
            log.warning("SATCAT refresh failed (%s); keeping the bundled snapshot", exc)
        try:
            r = await client.get(SPACE_WEATHER_URL, timeout=60)
            r.raise_for_status()
            today = date.today()
            latest = None
            for row in csv.DictReader(io.StringIO(r.text)):
                d = _date(row["DATE"])
                obs, last81 = _float(row["F10.7_OBS"]), _float(row["F10.7_OBS_LAST81"])
                if d and d <= today and not math.isnan(obs) and not math.isnan(last81):
                    latest = {"f107_obs": obs, "f107_last81": last81}
            if latest:
                self.f107 = latest
                log.info("Solar flux: %s", latest)
        except Exception as exc:  # noqa: BLE001
            log.warning("Space weather unavailable (%s); using training-time F10.7", exc)

    def score(self, catalog: list[dict]) -> None:
        self.forecasts, self.ineligible = self.forecast(catalog)
        self.scored_at = datetime.now(timezone.utc)
        log.info("Scored %d low-orbit objects (%d out of range)", len(self.forecasts), len(self.ineligible))

    def forecast(self, catalog: list[dict]) -> tuple[dict[int, Forecast], dict[int, str]]:
        """Run the models on catalogue entries (noradId, name, tleLine1, tleLine2)."""
        rows, meta = [], []
        ineligible: dict[int, str] = {}
        for sat in catalog:
            try:
                el = parse_tle(sat["tleLine1"], sat["tleLine2"])
            except (KeyError, ValueError):
                continue
            perigee, apogee = perigee_apogee_km(el.mean_motion, el.eccentricity)
            if el.mean_motion < MIN_MEAN_MOTION or perigee > MAX_PERIGEE_KM:
                ineligible[sat["noradId"]] = (
                    f"Perigee {float(perigee):,.0f} km is above the {MAX_PERIGEE_KM:.0f} km range the model was "
                    "trained on; drag is too weak for a re-entry within the forecast horizon."
                )
                continue
            cat = self.satcat.get(sat["noradId"], {})
            epoch = _tle_epoch(sat["tleLine1"])
            launch = cat.get("launch")
            rows.append(
                (
                    el.mean_motion,
                    el.eccentricity,
                    el.inclination,
                    el.ndot,
                    el.bstar,
                    OBJECT_TYPES.get(cat.get("type", "UNK"), OBJECT_TYPES["UNK"]),
                    cat.get("rcs", math.nan),
                    (epoch.date() - launch).days if launch else math.nan,
                    1.0 if "STARLINK" in sat["name"].upper() else 0.0,
                )
            )
            station_kept = sat["noradId"] in CREWED_STATIONS or (
                cat.get("status") == "+"
                and any(n in sat["name"].upper() for n in STATION_KEEPING_NAMES)
                and float(perigee) >= STATION_KEEPING_MIN_PERIGEE_KM
            )
            meta.append((sat["noradId"], sat["name"], float(perigee), float(apogee), epoch, station_kept))

        forecasts: dict[int, Forecast] = {}
        if rows:
            cols = list(zip(*rows))
            X = build_matrix(*cols, f107_obs=self.f107["f107_obs"], f107_last81=self.f107["f107_last81"])
            p = self.classifier.predict_proba(X)[:, 1]
            q = {k: m.predict(X) for k, m in self.quantiles.items()}  # log1p(days)
            mid = np.expm1(q[0.5])
            # Conformal margin calibrated at training time makes [lo, hi] an ~80% window.
            lo = np.expm1(np.minimum(q[0.1] - self.conformal_margin, q[0.5]))
            hi = np.expm1(np.maximum(q[0.9] + self.conformal_margin, q[0.5]))
            for i, (norad, name, perigee, apogee, epoch, station_kept) in enumerate(meta):
                forecasts[norad] = Forecast(
                    norad, name, perigee, apogee, float(p[i]), station_kept,
                    float(max(lo[i], 0)), float(max(mid[i], 0)), float(max(hi[i], 0)), epoch,
                )
        return forecasts, ineligible

    def station_kept_count(self, within_days: float = 365) -> int:
        return sum(
            1 for f in self.forecasts.values()
            if f.station_kept and f.probability_1y >= LIKELY_THRESHOLD and (f.days_p50 or 0) <= within_days
        )

    def get(self, norad_id: int) -> dict | None:
        if norad_id in self.forecasts:
            return self.forecasts[norad_id].to_dict()
        if norad_id in self.ineligible:
            return {"noradId": norad_id, "eligible": False, "reason": self.ineligible[norad_id]}
        return None

    def upcoming(self, within_days: float = 365, limit: int = 50, include_station_kept: bool = False) -> list[dict]:
        likely = [
            f for f in self.forecasts.values()
            if f.probability_1y >= LIKELY_THRESHOLD
            and f.days_p50 is not None
            and f.days_p50 <= within_days
            and (include_station_kept or not f.station_kept)
        ]
        likely.sort(key=lambda f: (f.tle_epoch + timedelta(days=f.days_p50)))
        return [f.to_dict() for f in likely[:limit]]


def _parse_satcat(text: str) -> dict[int, dict]:
    return {
        int(row["NORAD_CAT_ID"]): {
            "type": row["OBJECT_TYPE"],
            "status": row.get("OPS_STATUS_CODE") or "",
            "rcs": _float(row["RCS"]),
            "launch": _date(row["LAUNCH_DATE"]),
        }
        for row in csv.DictReader(io.StringIO(text))
        if row["NORAD_CAT_ID"].isdigit()
    }


def _float(s: str) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return math.nan


def _date(s: str) -> date | None:
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def _tle_epoch(line1: str) -> datetime:
    yy = int(line1[18:20])
    day_of_year = float(line1[20:32])
    year = 2000 + yy if yy < 57 else 1900 + yy
    return datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=day_of_year - 1)
