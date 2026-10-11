"""Download a compact, daily-sampled slice of historical TLEs for low orbits.

Source: Space-Track TLE history mirrored on Hugging Face (public domain US
government data), queried remotely with DuckDB so only the needed columns are
transferred. Output: data/tle_daily_<year>.parquet — one element set per
object per day (the last one of that day), perigee below 700 km.

Usage:  python training/download_history.py 2019 2026
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import duckdb

DATA = Path(__file__).resolve().parents[1] / "data"
URL = "https://huggingface.co/datasets/juliensimon/space-track-tle-history/resolve/main/data/tle_{year}.parquet"

QUERY = """
COPY (
  WITH t AS (
    SELECT norad_id, epoch, inclination, eccentricity, mean_motion, mean_motion_dot, bstar,
           -- semi-major axis from mean motion (rev/day) -> perigee altitude
           pow(398600.4418 / pow(mean_motion * 2 * pi() / 86400, 2), 1.0 / 3) AS sma_km
    FROM read_parquet('{url}')
    WHERE mean_motion > 11.25  -- period < 128 min, i.e. LEO-ish; prunes GEO/MEO early
  )
  SELECT norad_id,
         CAST(date_trunc('day', max(epoch)) AS DATE) AS day,
         max(epoch) AS epoch,
         arg_max(inclination, epoch) AS inclination,
         arg_max(eccentricity, epoch) AS eccentricity,
         arg_max(mean_motion, epoch) AS mean_motion,
         arg_max(mean_motion_dot, epoch) AS mean_motion_dot,
         arg_max(bstar, epoch) AS bstar,
         arg_max(sma_km, epoch) AS sma_km
  FROM t
  WHERE sma_km * (1 - eccentricity) - 6378.137 < 700
  GROUP BY norad_id, date_trunc('day', epoch)
) TO '{out}' (FORMAT parquet)
"""


def main(first: int, last: int) -> None:
    DATA.mkdir(exist_ok=True)
    con = duckdb.connect()
    con.sql("INSTALL httpfs; LOAD httpfs;")
    con.sql("SET enable_progress_bar = false")
    for year in range(first, last + 1):
        out = DATA / f"tle_daily_{year}.parquet"
        if out.exists():
            print(f"{year}: cached", flush=True)
            continue
        started = time.time()
        tmp = out.with_suffix(".tmp")
        con.sql(QUERY.format(url=URL.format(year=year), out=tmp.as_posix()))
        tmp.rename(out)
        rows = con.sql(f"SELECT count(*) FROM '{out.as_posix()}'").fetchone()[0]
        print(f"{year}: {rows:,} rows in {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]))
