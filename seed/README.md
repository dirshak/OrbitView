# Seed data

`satellites.json` contains a tiny curated catalog used:

- as a fallback when CelesTrak is unreachable (the API still works offline);
- for unit tests and load tests;
- as a classroom or lab demo so the UI is never empty.

The TLEs in this file are intentionally **dated 2024-001** (epoch year 24, day 1.5) so they are clearly stale — propagation works but positions will drift from reality. The `TleRefreshService` overwrites them with current values from CelesTrak on first run.

To replace with fresh TLEs, run the API once with internet access; the in-memory catalog will be populated by `CelesTrakTleProvider`.
