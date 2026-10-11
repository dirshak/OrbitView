"""Train the re-entry models and write models/reentry.joblib + models/metrics.json.

Models (scikit-learn HistGradientBoosting):
  classifier     P(object re-enters within 365 days)
  q10/q50/q90    quantile regressors on log(1 + days to re-entry), trained on
                 objects that re-entered within ~a year; q50 is the point
                 forecast and [q10, q90] the 80% window, widened by a
                 conformal margin (CQR) measured on held-out launches so the
                 window really contains ~80% of outcomes.

Evaluation holds out whole launches (all objects sharing an international
designator prefix) so Starlink batch-mates can't leak between train and test.
A physics baseline (exponential-atmosphere scale-height lifetime from the
current decay rate) is scored on the same rows for comparison.

Usage:  python training/train.py
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor
from sklearn.inspection import permutation_importance
from sklearn.metrics import (
    average_precision_score,
    brier_score_loss,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import GroupShuffleSplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.features import FEATURES, OBJECT_TYPES, build_matrix  # noqa: E402

DATA = ROOT / "data"
MODELS = ROOT / "models"
QUANTILES = (0.1, 0.5, 0.9)
HORIZON_BUCKETS = [(0, 7), (8, 30), (31, 90), (91, 180), (181, 365)]
SEED = 42


def features(df: pd.DataFrame) -> np.ndarray:
    return build_matrix(
        mean_motion=df.mean_motion,
        eccentricity=df.eccentricity,
        inclination=df.inclination,
        ndot=df.ndot,
        bstar=df.bstar,
        object_type=df.object_type.map(OBJECT_TYPES).fillna(OBJECT_TYPES["UNK"]),
        rcs_m2=df.rcs_m2,
        age_days=df.age_days,
        is_starlink=df.name.fillna("").str.contains("STARLINK").astype(float),
        f107_obs=df.f107_obs,
        f107_last81=df.f107_last81,
    )


def main() -> None:
    df = pd.read_parquet(DATA / "reentry_dataset.parquet")
    df["group"] = df.launch_id.fillna("norad-" + df.norad_id.astype(str))
    X = features(df)
    print(f"{len(df):,} rows, {df.norad_id.nunique():,} objects, {df.group.nunique():,} launches")

    split = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, test_idx = next(split.split(X, groups=df.group))
    is_train = np.zeros(len(df), dtype=bool)
    is_train[train_idx] = True

    # Undo the dataset's thinning so the model sees the true class balance.
    weight = np.where(df.days_to_decay <= 30, 1.0, np.where(df.days_to_decay <= 730, 3.0, 40.0))

    # ---- Classifier: re-entry within a year ----
    cls_rows = df.label_1y.notna().to_numpy()
    y_cls = df.label_1y.fillna(0).to_numpy().astype(int)
    tr = cls_rows & is_train
    te = cls_rows & ~is_train
    clf = HistGradientBoostingClassifier(
        max_iter=400,
        learning_rate=0.08,
        max_leaf_nodes=63,
        min_samples_leaf=50,
        l2_regularization=1.0,
        categorical_features=[FEATURES.index("object_type")],
        random_state=SEED,
    )
    clf.fit(X[tr], y_cls[tr], sample_weight=weight[tr])
    p = clf.predict_proba(X[te])[:, 1]
    pred = (p >= 0.5).astype(int)
    w_te = weight[te]
    baseline_pred = np.nan_to_num(X[te, FEATURES.index("physics_days")], nan=np.inf) <= 365
    cls_metrics = {
        "test_rows": int(te.sum()),
        "test_positive_rate": float(np.average(y_cls[te], weights=w_te)),
        "roc_auc": float(roc_auc_score(y_cls[te], p, sample_weight=w_te)),
        "average_precision": float(average_precision_score(y_cls[te], p, sample_weight=w_te)),
        "brier": float(brier_score_loss(y_cls[te], p, sample_weight=w_te)),
        "precision": float(precision_score(y_cls[te], pred, sample_weight=w_te)),
        "recall": float(recall_score(y_cls[te], pred, sample_weight=w_te)),
        "f1": float(f1_score(y_cls[te], pred, sample_weight=w_te)),
        "baseline_physics": {
            "precision": float(precision_score(y_cls[te], baseline_pred, sample_weight=w_te)),
            "recall": float(recall_score(y_cls[te], baseline_pred, sample_weight=w_te)),
            "f1": float(f1_score(y_cls[te], baseline_pred, sample_weight=w_te)),
        },
    }
    print("classifier", json.dumps(cls_metrics, indent=2))

    # ---- Quantile regressors: days until re-entry ----
    reg_rows = (df.days_to_decay <= 400).to_numpy()
    y_reg = np.log1p(df.days_to_decay.fillna(0).to_numpy())
    # Hold out 15% of the training launches to calibrate the interval width.
    calib_split = GroupShuffleSplit(n_splits=1, test_size=0.15, random_state=SEED + 1)
    fit_idx, calib_idx = next(calib_split.split(train_idx, groups=df.group.to_numpy()[train_idx]))
    is_calib = np.zeros(len(df), dtype=bool)
    is_calib[train_idx[calib_idx]] = True
    tr = reg_rows & is_train & ~is_calib
    regressors = {}
    for q in QUANTILES:
        model = HistGradientBoostingRegressor(
            loss="quantile",
            quantile=q,
            max_iter=500,
            learning_rate=0.06,
            max_leaf_nodes=63,
            min_samples_leaf=40,
            l2_regularization=1.0,
            categorical_features=[FEATURES.index("object_type")],
            random_state=SEED,
        )
        model.fit(X[tr], y_reg[tr], sample_weight=weight[tr])
        regressors[q] = model
        print(f"trained q{int(q * 100)}")

    # Conformalized quantile regression: widen [q10, q90] by the 80th-percentile
    # non-conformity score on calibration launches (in log-days).
    cal = (df.days_to_decay <= 365).to_numpy() & is_calib
    scores = np.maximum(
        regressors[0.1].predict(X[cal]) - y_reg[cal],
        y_reg[cal] - regressors[0.9].predict(X[cal]),
    )
    n_cal = scores.size
    conformal_margin = float(np.quantile(scores, min(1.0, np.ceil((n_cal + 1) * 0.8) / n_cal)))
    print(f"conformal margin (log-days): {conformal_margin:.3f} from {n_cal:,} calibration rows")

    te = (df.days_to_decay <= 365).to_numpy() & ~is_train
    actual = df.days_to_decay.to_numpy()[te]
    test_ids = df.norad_id.to_numpy()[te]
    raw = {q: m.predict(X[te]) for q, m in regressors.items()}
    mid = np.expm1(raw[0.5])
    lo = np.expm1(np.minimum(raw[0.1] - conformal_margin, raw[0.5])).clip(min=0)
    hi = np.expm1(np.maximum(raw[0.9] + conformal_margin, raw[0.5]))
    raw_coverage = np.mean((np.log1p(actual) >= raw[0.1]) & (np.log1p(actual) <= raw[0.9]))
    physics = X[te, FEATURES.index("physics_days")]
    # Baseline falls back to the training median when the orbit isn't decaying.
    physics = np.where(np.isnan(physics), np.median(df.days_to_decay[(df.days_to_decay <= 365) & is_train]), physics)

    def bucket_stats(mask: np.ndarray) -> dict:
        err = np.abs(mid[mask] - actual[mask])
        base_err = np.abs(physics[mask] - actual[mask])
        return {
            "rows": int(mask.sum()),
            "objects": int(np.unique(test_ids[mask]).size),
            "mae_days": float(err.mean()),
            "median_abs_error_days": float(np.median(err)),
            "baseline_mae_days": float(base_err.mean()),
            "baseline_median_abs_error_days": float(np.median(base_err)),
            "interval_coverage": float(np.mean((actual[mask] >= lo[mask]) & (actual[mask] <= hi[mask]))),
        }

    reg_metrics = {"overall": bucket_stats(np.ones_like(actual, dtype=bool))}
    print(f"80% window coverage before calibration {raw_coverage:.3f}, after {reg_metrics['overall']['interval_coverage']:.3f}")
    for a, b in HORIZON_BUCKETS:
        reg_metrics[f"{a}-{b}d"] = bucket_stats((actual >= a) & (actual <= b))
    print("regression", json.dumps(reg_metrics, indent=2))

    # Permutation importance for the median model on a sample of test rows.
    rng = np.random.default_rng(SEED)
    sample = rng.choice(np.flatnonzero(te), size=min(20000, int(te.sum())), replace=False)
    imp = permutation_importance(
        regressors[0.5], X[sample], y_reg[sample], n_repeats=3, random_state=SEED, n_jobs=-1
    )
    importance = sorted(
        ({"feature": f, "importance": float(v)} for f, v in zip(FEATURES, imp.importances_mean)),
        key=lambda d: -d["importance"],
    )

    last_sw = df.sort_values("day").dropna(subset=["f107_obs"]).iloc[-1]
    MODELS.mkdir(exist_ok=True)
    bundle = {
        "classifier": clf,
        "quantiles": regressors,
        "features": FEATURES,
        "sklearn_version": sklearn.__version__,
        "conformal_margin": conformal_margin,
        "f107_fallback": {"f107_obs": float(last_sw.f107_obs), "f107_last81": float(last_sw.f107_last81)},
    }
    joblib.dump(bundle, MODELS / "reentry.joblib", compress=3)

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data": {
            "source": "Space-Track TLE history (Hugging Face mirror), CelesTrak SATCAT decay dates, CelesTrak F10.7",
            "history_from": str(df.day.min()),
            "history_to": str(df.day.max()),
            "rows": int(len(df)),
            "objects": int(df.norad_id.nunique()),
            "reentered_objects": int(df.loc[df.days_to_decay.notna(), "norad_id"].nunique()),
            "split": "80/20 by launch (GroupShuffleSplit on international designator)",
        },
        "classifier": cls_metrics,
        "regression": reg_metrics,
        "interval": {
            "nominal": 0.8,
            "coverage_before_calibration": float(raw_coverage),
            "coverage_after_calibration": reg_metrics["overall"]["interval_coverage"],
            "conformal_margin_log_days": conformal_margin,
        },
        "feature_importance": importance,
        "sklearn_version": sklearn.__version__,
    }
    (MODELS / "metrics.json").write_text(json.dumps(metrics, indent=2))
    print("saved", MODELS / "reentry.joblib")


if __name__ == "__main__":
    main()
