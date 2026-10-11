"""Feature engineering shared by training and serving.

Every feature is computable from a single TLE plus catalogue metadata and the
current solar flux, so the live service (which only has the latest TLE per
object) sees exactly the inputs the models were trained on.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

MU_KM3_S2 = 398600.4418
EARTH_EQ_RADIUS_KM = 6378.137
# Altitude at which an object is effectively re-entering, and a representative
# thermosphere density scale height for 200-600 km.
REENTRY_ALTITUDE_KM = 180.0
SCALE_HEIGHT_KM = 60.0

OBJECT_TYPES = {"PAY": 0.0, "R/B": 1.0, "DEB": 2.0, "UNK": 3.0}

FEATURES = [
    "perigee_km",
    "apogee_km",
    "eccentricity",
    "inclination",
    "mean_motion",
    "ndot",
    "bstar",
    "ndot_over_n",
    "physics_days",
    "object_type",
    "rcs_m2",
    "age_days",
    "is_starlink",
    "f107_obs",
    "f107_last81",
]

# Objects outside this envelope are never scored: the training set only
# contains orbits with perigee below 700 km.
MAX_PERIGEE_KM = 700.0
MIN_MEAN_MOTION = 11.25


@dataclass
class Elements:
    mean_motion: float  # rev/day
    eccentricity: float
    inclination: float  # deg
    ndot: float  # TLE first derivative field (rev/day^2, already halved)
    bstar: float


def semi_major_axis_km(mean_motion_rev_day: np.ndarray | float) -> np.ndarray | float:
    n = np.asarray(mean_motion_rev_day, dtype=float) * 2 * math.pi / 86400.0
    return np.cbrt(MU_KM3_S2 / n**2)


def perigee_apogee_km(mean_motion, eccentricity):
    a = semi_major_axis_km(mean_motion)
    e = np.asarray(eccentricity, dtype=float)
    return a * (1 - e) - EARTH_EQ_RADIUS_KM, a * (1 + e) - EARTH_EQ_RADIUS_KM


def physics_days_to_reentry(mean_motion, ndot):
    """Physics baseline: exponential-atmosphere (scale-height) lifetime estimate.

    With density ~ exp(-h/H), the decay rate grows as the orbit drops, and
    integrating dh/dt = -k exp(-h/H) from today's altitude gives
        t = H / |dh/dt| * (1 - exp(-(h - h_reentry) / H)).
    |dh/dt| comes from the TLE: a ~ n^(-2/3) so da/dt = -(2/3) a (dn/dt) / n,
    and the TLE ndot field is half of dn/dt. NaN when the orbit isn't decaying.
    """
    mm = np.asarray(mean_motion, dtype=float)
    nd = np.asarray(ndot, dtype=float)
    a = semi_major_axis_km(mm)
    h = a - EARTH_EQ_RADIUS_KM
    with np.errstate(divide="ignore", invalid="ignore"):
        decay_km_day = (2.0 / 3.0) * a * (2 * nd) / mm
        days = SCALE_HEIGHT_KM / decay_km_day * (1 - np.exp(-(h - REENTRY_ALTITUDE_KM) / SCALE_HEIGHT_KM))
    days = np.where(nd > 0, days, np.nan)
    days = np.where(h <= REENTRY_ALTITUDE_KM, 0.0, days)
    return np.clip(days, 0, 20000)


def build_matrix(
    mean_motion,
    eccentricity,
    inclination,
    ndot,
    bstar,
    object_type,
    rcs_m2,
    age_days,
    is_starlink,
    f107_obs,
    f107_last81,
) -> np.ndarray:
    """Return an (n, len(FEATURES)) float matrix in FEATURES order."""
    mm = np.asarray(mean_motion, dtype=float)
    perigee, apogee = perigee_apogee_km(mm, eccentricity)
    nd = np.asarray(ndot, dtype=float)
    cols = {
        "perigee_km": perigee,
        "apogee_km": apogee,
        "eccentricity": np.asarray(eccentricity, dtype=float),
        "inclination": np.asarray(inclination, dtype=float),
        "mean_motion": mm,
        "ndot": nd,
        "bstar": np.asarray(bstar, dtype=float),
        "ndot_over_n": nd / mm,
        "physics_days": physics_days_to_reentry(mm, nd),
        "object_type": np.asarray(object_type, dtype=float),
        "rcs_m2": np.asarray(rcs_m2, dtype=float),
        "age_days": np.asarray(age_days, dtype=float),
        "is_starlink": np.asarray(is_starlink, dtype=float),
        "f107_obs": np.broadcast_to(np.asarray(f107_obs, dtype=float), mm.shape),
        "f107_last81": np.broadcast_to(np.asarray(f107_last81, dtype=float), mm.shape),
    }
    return np.column_stack([cols[name] for name in FEATURES])


def parse_tle_exponent(field: str) -> float:
    """Parse TLE 'assumed decimal' notation, e.g. ' 20582-3' -> 0.20582e-3."""
    s = field.strip()
    if not s:
        return 0.0
    sign = -1.0 if s[0] == "-" else 1.0
    s = s.lstrip("+-")
    mantissa, exp = s[:-2], s[-2:]
    try:
        return sign * float(f"0.{mantissa}") * 10 ** int(exp)
    except ValueError:
        return 0.0


def parse_tle(line1: str, line2: str) -> Elements:
    return Elements(
        mean_motion=float(line2[52:63]),
        eccentricity=float(f"0.{line2[26:33].strip()}"),
        inclination=float(line2[8:16]),
        ndot=float(line1[33:43]),
        bstar=parse_tle_exponent(line1[53:61]),
    )
