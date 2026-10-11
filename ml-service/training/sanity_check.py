"""Score the live catalogue (from the running backend) and print forecasts for
well-known objects plus how many objects are flagged per perigee band.

Usage:  python training/sanity_check.py [backend_url]
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.reentry import ReentryPredictor  # noqa: E402

KNOWN = {
    25544: "ISS (reboosted regularly)",
    48274: "Tiangong / Tianhe (reboosted)",
    20580: "Hubble (no propulsion, ~470 km)",
    43013: "NOAA 20 (~820 km, out of scope)",
}


def main(backend: str) -> None:
    catalog = httpx.get(f"{backend}/api/satellites", timeout=60).json()
    predictor = ReentryPredictor()
    predictor.score(catalog)

    for norad, note in KNOWN.items():
        f = predictor.get(norad)
        if not f:
            print(f"{norad:>6} {note}: not in catalogue")
        elif not f["eligible"]:
            print(f"{norad:>6} {note}: out of scope")
        else:
            when = f"~{f['daysP50']:.0f} d ({f['windowStart']} → {f['windowEnd']})" if f["likelyWithinYear"] else "not within a year"
            print(f"{norad:>6} {note}: P(1y)={f['probabilityWithinYear']:.2f}, {when}")

    bands = Counter()
    flagged = Counter()
    for f in predictor.forecasts.values():
        band = f"{int(f.perigee_km // 100) * 100}-{int(f.perigee_km // 100) * 100 + 99} km"
        bands[band] += 1
        flagged[band] += f.probability_1y >= 0.5
    print("\nperigee band     objects  flagged<1y")
    for band in sorted(bands, key=lambda b: int(b.split("-")[0])):
        print(f"{band:<16} {bands[band]:>7} {flagged[band]:>10}")
    print("\nsoonest:", [(f["name"], f["daysP50"]) for f in predictor.upcoming(30, 8)])


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:5080")
