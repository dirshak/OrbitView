# OrbitView ML service

Python/FastAPI container that adds two AI features to OrbitView:

| Feature | What it does | Endpoint |
|---|---|---|
| **Re-entry forecasting** | Gradient-boosted models predict whether a low-orbit object will fall back to Earth within a year, and when (with an 80% window). | `GET /ml/reentry/{noradId}`, `GET /ml/reentry?within_days=30`, `GET /ml/reentry/model-card` |
| **Ask OrbitView assistant** | Groq-hosted LLM with tool calling over OrbitView's own data (catalogue search, live position, pass prediction, re-entry forecasts, missions). | `POST /ml/assistant/chat` |

The frontend reaches it through nginx at `/ml/…`; locally it listens on port 5090.

## Configuration (`.env` in the repo root)

```
GROQ_API_KEY=gsk_...            # https://console.groq.com/keys — server-side only
GROQ_MODEL=openai/gpt-oss-120b  # any Groq chat model with tool use
```

Without a key the re-entry features still work; the assistant shows a setup hint.

## Re-entry models

**Data** (all public, no account needed)
- Historical TLEs 2019–2026: Space-Track history mirrored on Hugging Face
  (`juliensimon/space-track-tle-history`), queried remotely with DuckDB and
  reduced to one element set per object per day for perigees below 700 km.
- Labels: actual re-entry (decay) dates from the CelesTrak SATCAT.
- Solar activity: daily F10.7 flux from CelesTrak space weather (drives
  atmospheric density, hence drag).

**Features** (all computable from one TLE, so serving matches training):
perigee/apogee altitude, eccentricity, inclination, mean motion, ṅ (decay
rate), B* (drag term), relative decay rate, a physics lifetime estimate
(exponential-atmosphere scale-height formula), object type, radar
cross-section, age in orbit, Starlink flag, F10.7 today and its 81-day mean.

**Models** (scikit-learn `HistGradientBoosting*`)
1. Classifier: P(re-entry within 365 days).
2–4. Quantile regressors (10th/50th/90th percentile) on log(1 + days to
   re-entry). The [q10, q90] window is widened with conformalized quantile
   regression (CQR) on held-out launches so it covers ~80% of outcomes.

**Evaluation**: 80/20 split by *launch* (international designator), so
satellites from the same launch never appear in both train and test. Every
metric is compared with the physics baseline on the same rows. Results are
in `models/metrics.json` and in the app under *Re-entry Watch → Model card*.

**Limits**: statistical estimate from passive decay; it can't know about
future manoeuvres, reboosts (e.g. the ISS) or controlled de-orbits, and
objects with perigee above 700 km are out of scope.

## Retraining

```bash
cd ml-service
python -m venv .venv && .venv/Scripts/pip install -r requirements-train.txt   # Windows path
curl -o data/satcat.csv https://celestrak.org/pub/satcat.csv
curl -o data/SW-All.csv https://celestrak.org/SpaceData/SW-All.csv
python training/download_history.py 2019 2026   # ~20 min, ~600 MB in data/
python training/build_dataset.py
python training/train.py                         # writes models/
docker compose up -d --build ml-service
```

## Spacecraft Health (telemetry anomaly detection)

Per-channel gradient-boosting forecasters on NASA's SMAP/MSL telemetry anomaly
dataset, with Telemanom's nonparametric dynamic threshold for alerts. Results
are served at `GET /ml/telemetry/summary` and `GET /ml/telemetry/channels/{id}`
for the dashboard. Test results: 36 of 105 anomalies caught at 81.8%
precision. NASA/JPL's published LSTM detector (Telemanom) performs better:
80% caught at 87.5% precision. Full details are in `AI_FEATURES.txt`.

```bash
python training/download_smap_msl.py   # ~170 MB into data/smap_msl, verified against JPL labels
python training/train_anomaly.py       # ~9 min; writes models/health/
```
