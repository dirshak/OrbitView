"""Spacecraft telemetry anomaly detection on NASA SMAP/MSL.

Per channel:
  1. Forecaster  HistGradientBoostingRegressor predicts the next telemetry value
                 from recent values, rolling statistics and recent commands.
                 Trained only on the (nominal) training split.
  2. Errors      e_t = |y_t - y_hat_t| on the test split, smoothed with an EWMA
                 (span 105, as in Telemanom).
  3. Threshold   Telemanom's nonparametric dynamic threshold (Hundman et al.,
                 KDD 2018): pick eps = mean + z*std of the smoothed errors that
                 best separates a few anomalous sequences from the rest. No
                 labels are used.
  4. Pruning     drop flagged sequences whose peak error isn't clearly above the
                 next one (p = 0.13).

Scoring follows Telemanom: a labelled anomaly is detected (TP) if any alert
overlaps it; an alert overlapping no labelled anomaly is a false positive.
Baseline: classic out-of-limits checking (value outside its training range).

Output: models/health/results.npz (per-channel series for the dashboard) and
        models/health/metrics.json
Usage:  python training/train_anomaly.py
"""

from __future__ import annotations

import ast
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data" / "smap_msl"
OUT = ROOT / "models" / "health"

LAGS = 30  # previous values used as inputs
STATS_WINDOW = 250  # rolling-statistics window (Telemanom's l_s)
CMD_WINDOW = 50  # recent-command window
SMOOTHING_SPAN = 105  # Telemanom: batch 70 * window 30 * 5%
ERROR_BUFFER = 100  # steps added either side of a flagged point
Z_RANGE = np.arange(2.5, 12.0, 0.5)
PRUNE_P = 0.13
OOL_MARGIN = 0.05  # out-of-limits margin, as a fraction of the training range
SEED = 42

# Published Telemanom results (README of khundman/telemanom) for comparison.
TELEMANOM = {
    "SMAP": {"precision": 0.855, "recall": 0.855},
    "MSL": {"precision": 0.926, "recall": 0.694},
    "total": {"precision": 0.875, "recall": 0.800},
}


def features(series: np.ndarray) -> np.ndarray:
    """Inputs for predicting series[t, 0] from data strictly before t."""
    y = pd.Series(series[:, 0])
    cmds = pd.DataFrame(series[:, 1:])
    cols = {f"lag{k}": y.shift(k) for k in range(1, LAGS + 1)}
    past = y.shift(1)
    roll = past.rolling(STATS_WINDOW, min_periods=LAGS)
    cols |= {
        "roll_mean": roll.mean(),
        "roll_std": roll.std(),
        "roll_min": roll.min(),
        "roll_max": roll.max(),
        "diff1": past - y.shift(2),
    }
    recent_cmds = cmds.shift(1).rolling(CMD_WINDOW, min_periods=1).sum()
    cols |= {f"cmd{j}_recent": recent_cmds[j] for j in recent_cmds.columns}
    cols |= {f"cmd{j}_now": cmds[j] for j in cmds.columns}  # commands are known when sent
    cols["cmd_total_recent"] = recent_cmds.sum(axis=1)
    return pd.DataFrame(cols).to_numpy(dtype=np.float32)


def to_sequences(mask: np.ndarray) -> list[tuple[int, int]]:
    """Contiguous True runs as inclusive (start, end) index pairs."""
    padded = np.concatenate([[False], mask, [False]])
    edges = np.flatnonzero(np.diff(padded.astype(int)))
    return [(int(s), int(e) - 1) for s, e in zip(edges[::2], edges[1::2])]


def buffered(indices: np.ndarray, n: int) -> np.ndarray:
    mask = np.zeros(n, dtype=bool)
    for i in indices:
        mask[max(0, i - ERROR_BUFFER): min(n, i + ERROR_BUFFER + 1)] = True
    return mask


def dynamic_threshold(e_s: np.ndarray) -> float | None:
    """Telemanom epsilon selection; None when nothing stands out."""
    mean, sd = e_s.mean(), e_s.std()
    if sd == 0:
        return None
    best, best_eps = -np.inf, None
    for z in Z_RANGE:
        eps = mean + z * sd
        below = e_s[e_s < eps]
        above = np.flatnonzero(e_s >= eps)
        if above.size == 0:
            continue
        seqs = to_sequences(buffered(above, e_s.size))
        if len(seqs) > 5 or above.size >= 0.5 * e_s.size:
            continue
        score = ((mean - below.mean()) / mean + (sd - below.std()) / sd) / (len(seqs) ** 2 + above.size)
        if score >= best:
            best, best_eps = score, eps
    return best_eps


def detect(e_s: np.ndarray, y_test: np.ndarray) -> tuple[list[tuple[int, int]], float | None]:
    # Ignore channels whose errors are negligible relative to the signal (Telemanom check).
    y_range = np.percentile(y_test, 95) - np.percentile(y_test, 5)
    if e_s.max() <= 0.05 or not (e_s.std() > 0.05 * y_test.std() or e_s.max() > 0.05 * y_range):
        return [], None
    eps = dynamic_threshold(e_s)
    if eps is None:
        return [], None
    seqs = to_sequences(buffered(np.flatnonzero(e_s >= eps), e_s.size))
    if not seqs:
        return [], eps
    # Pruning: keep sequences whose peak error clearly exceeds the next-largest.
    peaks = np.array([e_s[s: e + 1].max() for s, e in seqs])
    normal_max = e_s[~np.isin(np.arange(e_s.size), np.concatenate([np.arange(s, e + 1) for s, e in seqs]))]
    ranked = np.sort(np.append(peaks, normal_max.max() if normal_max.size else 0.0))[::-1]
    drop_below = None
    for i in range(len(ranked) - 1):
        if (ranked[i] - ranked[i + 1]) / ranked[i] < PRUNE_P:
            drop_below = ranked[i] if drop_below is None else drop_below
        else:
            drop_below = None
    if drop_below is not None:
        seqs = [s for s, p in zip(seqs, peaks) if p > drop_below]
    return seqs, eps


def out_of_limits(y_train: np.ndarray, y_test: np.ndarray) -> list[tuple[int, int]]:
    lo, hi = y_train.min(), y_train.max()
    margin = OOL_MARGIN * (hi - lo if hi > lo else 1.0)
    return to_sequences((y_test < lo - margin) | (y_test > hi + margin))


def score(pred: list[tuple[int, int]], truth: list[tuple[int, int]]) -> dict:
    overlaps = lambda a, b: a[0] <= b[1] and b[0] <= a[1]  # noqa: E731
    tp = sum(any(overlaps(t, p) for p in pred) for t in truth)
    fp = sum(not any(overlaps(p, t) for t in truth) for p in pred)
    delays = []
    for t in truth:
        starts = [max(p[0], t[0]) for p in pred if overlaps(t, p)]
        if starts:
            delays.append(min(starts) - t[0])
    return {"tp": tp, "fn": len(truth) - tp, "fp": fp, "delays": delays}


def summarize(rows: list[dict]) -> dict:
    tp = sum(r["tp"] for r in rows)
    fp = sum(r["fp"] for r in rows)
    fn = sum(r["fn"] for r in rows)
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = lambda beta: (1 + beta**2) * p * r / (beta**2 * p + r) if p + r else 0.0  # noqa: E731
    delays = [d for row in rows for d in row["delays"]]
    return {
        "anomalies": tp + fn, "detected": tp, "missed": fn, "false_alarms": fp,
        "precision": p, "recall": r, "f1": f(1), "f05": f(0.5),
        "median_detection_delay_steps": float(np.median(delays)) if delays else None,
    }


def main() -> None:
    labels = list(csv.DictReader(open(DATA / "labeled_anomalies.csv", encoding="utf-8")))
    OUT.mkdir(parents=True, exist_ok=True)
    series: dict[str, np.ndarray] = {}
    channels, model_rows, ool_rows = [], [], []

    for row in labels:
        chan, craft = row["chan_id"], row["spacecraft"]
        train = np.load(DATA / "train" / f"{chan}.npy")
        test = np.load(DATA / "test" / f"{chan}.npy")
        truth = [tuple(map(int, s)) for s in ast.literal_eval(row["anomaly_sequences"])]
        classes = [c.strip() for c in row["class"].strip("[]").split(",")]

        X_train, y_train = features(train)[LAGS:], train[LAGS:, 0]
        model = HistGradientBoostingRegressor(
            max_iter=200, learning_rate=0.1, max_leaf_nodes=31, min_samples_leaf=20, random_state=SEED
        )
        model.fit(X_train, y_train)

        y_test = test[:, 0]
        y_hat = np.full(y_test.size, np.nan, dtype=np.float32)
        y_hat[LAGS:] = model.predict(features(test)[LAGS:])
        err = np.abs(y_test - y_hat)
        err[:LAGS] = 0.0
        e_s = pd.Series(err).ewm(span=SMOOTHING_SPAN).mean().to_numpy()

        alerts, eps = detect(e_s, y_test)
        ool = out_of_limits(train[:, 0], y_test)
        m, o = score(alerts, truth), score(ool, truth)
        m["spacecraft"] = o["spacecraft"] = craft
        model_rows.append(m)
        ool_rows.append(o)

        series[f"{chan}/y"] = y_test.astype(np.float32)
        series[f"{chan}/y_hat"] = y_hat
        series[f"{chan}/e_s"] = e_s.astype(np.float32)
        channels.append({
            "id": chan,
            "spacecraft": craft,
            "length": int(y_test.size),
            "threshold": None if eps is None else float(eps),
            "labelled": [{"start": s, "end": e, "class": c} for (s, e), c in zip(truth, classes)],
            "alerts": [{"start": s, "end": e, "peak_error": float(e_s[s: e + 1].max())} for s, e in alerts],
            "outOfLimits": [{"start": s, "end": e} for s, e in ool],
            "detected": m["tp"], "missed": m["fn"], "falseAlarms": m["fp"],
            "baselineDetected": o["tp"], "baselineFalseAlarms": o["fp"],
            "trainRmse": float(np.sqrt(np.mean((model.predict(X_train) - y_train) ** 2))),
        })
        print(f"{chan:>5} {craft:<4} truth={len(truth)} detected={m['tp']} fp={m['fp']} | OOL detected={o['tp']} fp={o['fp']}")

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "dataset": {
            "name": "NASA SMAP & MSL telemetry anomalies (Hundman et al., KDD 2018)",
            "channels": len(labels),
            "anomalies": sum(len(c["labelled"]) for c in channels),
            "test_values": int(sum(c["length"] for c in channels)),
        },
        "method": {
            "forecaster": "HistGradientBoostingRegressor per channel (200 iters, lr 0.1, 31 leaves)",
            "inputs": f"{LAGS} lags, {STATS_WINDOW}-step rolling mean/std/min/max, last change, commands (current + last {CMD_WINDOW} steps)",
            "smoothing_span": SMOOTHING_SPAN,
            "threshold": "Telemanom nonparametric dynamic threshold, z in 2.5..11.5, error buffer 100, pruning p=0.13",
            "baseline": f"Out-of-limits: value outside training min/max +/- {OOL_MARGIN:.0%} of range",
        },
        "results": {
            "model": {k: summarize([r for r in model_rows if k == "total" or r["spacecraft"] == k]) for k in ("SMAP", "MSL", "total")},
            "out_of_limits": {k: summarize([r for r in ool_rows if k == "total" or r["spacecraft"] == k]) for k in ("SMAP", "MSL", "total")},
            "telemanom_published": TELEMANOM,
        },
        "sklearn_version": sklearn.__version__,
    }
    np.savez_compressed(OUT / "results.npz", **series)
    (OUT / "channels.json").write_text(json.dumps(channels))
    (OUT / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics["results"], indent=2))


if __name__ == "__main__":
    main()
