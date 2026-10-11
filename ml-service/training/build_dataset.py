"""Build the supervised re-entry dataset from downloaded TLE history.

Inputs (all in data/):
  tle_daily_<year>.parquet  daily element sets, from download_history.py
  satcat.csv                CelesTrak SATCAT: decay dates (labels), type, RCS
  SW-All.csv                CelesTrak space weather: F10.7 solar flux

Each row is one object on one day. Targets:
  days_to_decay   days from that element set to the catalogued re-entry
                  (only for objects that have re-entered)
  label_1y        1 = re-entered within 365 days, 0 = still in orbit 365 days
                  later, NULL = can't tell yet (too close to the end of the data)

Usage:  python training/build_dataset.py
"""

from __future__ import annotations

from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parents[1] / "data"
MODELS = Path(__file__).resolve().parents[1] / "models"


def main() -> None:
    con = duckdb.connect()
    con.sql("SET enable_progress_bar = false")
    con.sql(f"""
        CREATE VIEW tle AS
        SELECT * FROM read_parquet('{(DATA / "tle_daily_*.parquet").as_posix()}')
    """)
    con.sql(f"""
        CREATE TABLE satcat AS
        SELECT NORAD_CAT_ID AS norad_id,
               OBJECT_NAME AS name,
               OBJECT_TYPE AS object_type,
               substr(OBJECT_ID, 1, 8) AS launch_id,
               TRY_CAST(LAUNCH_DATE AS DATE) AS launch_date,
               TRY_CAST(DECAY_DATE AS DATE) AS decay_date,
               TRY_CAST(RCS AS DOUBLE) AS rcs_m2
        FROM read_csv('{(DATA / "satcat.csv").as_posix()}', header = true, all_varchar = true)
    """)
    con.sql(f"""
        CREATE TABLE sw AS
        SELECT CAST(DATE AS DATE) AS day,
               TRY_CAST("F10.7_OBS" AS DOUBLE) AS f107_obs,
               TRY_CAST("F10.7_OBS_LAST81" AS DOUBLE) AS f107_last81
        FROM read_csv('{(DATA / "SW-All.csv").as_posix()}', header = true, all_varchar = true)
    """)

    # Last day with real coverage (a few stray far-future epochs exist in the source).
    data_end = con.sql(
        "SELECT max(day) FROM (SELECT day FROM tle GROUP BY day HAVING count(*) > 1000)"
    ).fetchone()[0]
    print("history ends", data_end)

    out = DATA / "reentry_dataset.parquet"
    con.sql(f"""
        COPY (
          WITH j AS (
            SELECT t.*,
                   s.name, s.object_type, s.launch_id, s.rcs_m2, s.decay_date,
                   date_diff('day', s.launch_date, t.day) AS age_days,
                   date_diff('day', t.day, s.decay_date) AS days_to_decay,
                   w.f107_obs, w.f107_last81,
                   hash(t.norad_id, t.day) AS h
            FROM tle t
            JOIN satcat s USING (norad_id)
            LEFT JOIN sw w ON w.day = t.day
          ),
          labelled AS (
            SELECT *,
                   CASE
                     WHEN days_to_decay BETWEEN 0 AND 365 THEN 1
                     WHEN (decay_date IS NULL OR days_to_decay > 365)
                          AND day <= DATE '{data_end}' - INTERVAL 365 DAY THEN 0
                   END AS label_1y
            FROM j
            WHERE days_to_decay IS NULL OR days_to_decay >= 0  -- drop post-decay glitches
          )
          SELECT norad_id, day, name, object_type, launch_id, rcs_m2, age_days,
                 mean_motion, eccentricity, inclination, mean_motion_dot AS ndot, bstar,
                 f107_obs, f107_last81, days_to_decay, label_1y
          FROM labelled
          -- Keep every day of the final month, thin out longer horizons and
          -- surviving objects (otherwise thousands of active Starlinks dominate).
          WHERE (days_to_decay <= 30)
             OR (days_to_decay <= 365 AND h % 3 = 0)
             OR (days_to_decay <= 730 AND h % 7 = 0)
             OR (label_1y = 0 AND h % 40 = 0)
        ) TO '{out.as_posix()}' (FORMAT parquet)
    """)
    summary = con.sql(f"""
        SELECT count(*) AS rows,
               count(DISTINCT norad_id) AS objects,
               count(*) FILTER (WHERE label_1y = 1) AS pos_1y,
               count(*) FILTER (WHERE label_1y = 0) AS neg_1y,
               count(DISTINCT norad_id) FILTER (WHERE days_to_decay IS NOT NULL) AS decayed_objects
        FROM '{out.as_posix()}'
    """).df()
    print(summary.to_string(index=False))

    # Compact SATCAT snapshot shipped with the models so the service can score
    # immediately on startup (CelesTrak is slow/throttled for this file).
    MODELS.mkdir(exist_ok=True)
    con.sql(f"""
        COPY (
          SELECT NORAD_CAT_ID, OBJECT_TYPE, OPS_STATUS_CODE, RCS, LAUNCH_DATE
          FROM read_csv('{(DATA / "satcat.csv").as_posix()}', header = true, all_varchar = true)
          WHERE DECAY_DATE IS NULL
        ) TO '{(MODELS / "satcat_snapshot.csv.gz").as_posix()}' (HEADER, COMPRESSION gzip)
    """)


if __name__ == "__main__":
    main()
