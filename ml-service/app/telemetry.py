"""Serves the spacecraft-telemetry anomaly detection results (NASA SMAP/MSL)
produced by training/train_anomaly.py, for the Spacecraft Health dashboard."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

HEALTH = Path(__file__).resolve().parents[1] / "models" / "health"


class TelemetryReplay:
    def __init__(self) -> None:
        self.metrics = json.loads((HEALTH / "metrics.json").read_text())
        channels = json.loads((HEALTH / "channels.json").read_text())
        # NASA's label file lists P-2 twice; give each row a unique key.
        seen: dict[str, int] = {}
        for ch in channels:
            seen[ch["id"]] = seen.get(ch["id"], 0) + 1
            ch["key"] = ch["id"] if seen[ch["id"]] == 1 else f"{ch['id']} #{seen[ch['id']]}"
        self.channels = {ch["key"]: ch for ch in channels}
        self._npz = np.load(HEALTH / "results.npz")
        self._cache: dict[tuple[str, int], dict] = {}

    def summary(self) -> dict:
        fields = ("key", "id", "spacecraft", "length", "detected", "missed", "falseAlarms",
                  "baselineDetected", "baselineFalseAlarms")
        return {
            "metrics": self.metrics,
            "channels": [
                {**{f: ch[f] for f in fields}, "labelled": len(ch["labelled"]), "alerts": len(ch["alerts"])}
                for ch in self.channels.values()
            ],
        }

    def channel(self, key: str, points: int) -> dict | None:
        ch = self.channels.get(key)
        if ch is None:
            return None
        points = max(200, min(points, 4000))
        cache_key = (ch["id"], points)
        if cache_key not in self._cache:
            self._cache[cache_key] = _series(ch["id"], points, self._npz)
        return {**ch, **self._cache[cache_key]}


def _series(chan_id: str, points: int, npz) -> dict:
    y = npz[f"{chan_id}/y"]
    y_hat = npz[f"{chan_id}/y_hat"]
    err = npz[f"{chan_id}/e_s"]
    n = y.size
    buckets = max(1, points // 2)
    edges = [int(e) for e in np.linspace(0, n, buckets + 1)]
    idx: list[int] = []
    err_x: list[int] = []
    err_y: list[float] = []
    for a, b in zip(edges[:-1], edges[1:]):
        if b <= a:
            continue
        seg = y[a:b]
        lo, hi = a + int(np.argmin(seg)), a + int(np.argmax(seg))
        idx.extend(sorted({lo, hi}))  # min/max keeps spikes visible
        e = err[a:b]
        k = a + int(np.argmax(e))
        err_x.append(k)
        err_y.append(float(e.max()))
    idx_arr = np.array(idx)
    pred = y_hat[idx_arr]
    return {
        "value": {"x": idx_arr.tolist(), "y": np.round(y[idx_arr], 4).tolist()},
        "predicted": {
            "x": idx_arr.tolist(),
            "y": [None if np.isnan(v) else round(float(v), 4) for v in pred],
        },
        "error": {"x": err_x, "y": [round(v, 5) for v in err_y]},
    }
