import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  eciToEcf,
  ecfToLookAngles,
  degreesLat,
  degreesLong,
  type SatRec,
} from "satellite.js";
import type {
  PassWindow,
  SatelliteRecord,
  SatellitePosition,
} from "../types/satellite";

const EARTH_RADIUS_KM = 6371;

const satrecCache = new Map<number, SatRec>();

function getSatrec(sat: SatelliteRecord): SatRec {
  let rec = satrecCache.get(sat.noradId);
  if (!rec) {
    rec = twoline2satrec(sat.tleLine1, sat.tleLine2);
    satrecCache.set(sat.noradId, rec);
  }
  return rec;
}

/** Compute satellite position at a given Date. Returns null if propagation fails. */
export function propagatePosition(
  sat: SatelliteRecord,
  date: Date = new Date()
): SatellitePosition | null {
  try {
    const rec = getSatrec(sat);
    const pv = propagate(rec, date);
    if (!pv || !pv.position || typeof pv.position === "boolean") return null;
    if (!pv.velocity || typeof pv.velocity === "boolean") return null;

    const gmst = gstime(date);
    const geo = eciToGeodetic(pv.position, gmst);
    const v = pv.velocity;
    const speedKmS = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);

    return {
      latitudeDeg: degreesLat(geo.latitude),
      longitudeDeg: degreesLong(geo.longitude),
      altitudeKm: geo.height,
      velocityKmS: speedKmS,
      timestamp: date.getTime(),
    };
  } catch {
    return null;
  }
}

/**
 * Compute a list of positions sampled across one full orbit so we can draw
 * an orbit polyline. We sample by orbital period derived from mean motion.
 */
export function computeOrbitTrail(
  sat: SatelliteRecord,
  start: Date = new Date(),
  samples = 120
): SatellitePosition[] {
  const meanMotion = Number.parseFloat(sat.tleLine2.slice(52, 63));
  if (!Number.isFinite(meanMotion) || meanMotion <= 0) return [];
  const periodMinutes = 1440 / meanMotion;
  const stepMs = (periodMinutes * 60_000) / samples;

  const trail: SatellitePosition[] = [];
  for (let i = 0; i < samples; i += 1) {
    const t = new Date(start.getTime() + i * stepMs);
    const p = propagatePosition(sat, t);
    if (p) trail.push(p);
  }
  return trail;
}

/**
 * Convert geodetic lat/lon/alt to a position on a unit-radius sphere of
 * radius `earthRadius`, with altitude scaled relative to Earth radius.
 */
export function geodeticToVector3(
  latDeg: number,
  lonDeg: number,
  altKm: number,
  earthRadius: number
): { x: number; y: number; z: number } {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const r = earthRadius * (1 + altKm / EARTH_RADIUS_KM);
  // Three.js convention: y is up; map lat->y, lon->xz plane.
  const x = r * Math.cos(lat) * Math.cos(lon);
  const y = r * Math.sin(lat);
  const z = -r * Math.cos(lat) * Math.sin(lon);
  return { x, y, z };
}

/**
 * Compute the next N pass windows of a satellite over an observer location.
 * A "pass" is any contiguous window where elevation > 0; we report start/peak/end
 * and a simple visibility score based on max elevation and Sun illumination heuristic.
 */
export function predictPasses(
  sat: SatelliteRecord,
  observer: { latitudeDeg: number; longitudeDeg: number; heightKm?: number },
  options: { hours?: number; stepSeconds?: number; maxPasses?: number } = {}
): PassWindow[] {
  const { hours = 48, stepSeconds = 30, maxPasses = 5 } = options;
  const rec = getSatrec(sat);
  const observerGd = {
    latitude: (observer.latitudeDeg * Math.PI) / 180,
    longitude: (observer.longitudeDeg * Math.PI) / 180,
    height: observer.heightKm ?? 0,
  };

  const totalSteps = Math.floor((hours * 3600) / stepSeconds);
  const passes: PassWindow[] = [];

  let inPass = false;
  let passStart = 0;
  let peakEl = -Infinity;
  let peakTime = 0;

  const startMs = Date.now();
  for (let i = 0; i < totalSteps; i += 1) {
    const t = new Date(startMs + i * stepSeconds * 1000);
    const pv = propagate(rec, t);
    if (!pv || !pv.position || typeof pv.position === "boolean") continue;
    const gmst = gstime(t);
    const ecf = eciToEcf(pv.position, gmst);
    const look = ecfToLookAngles(observerGd, ecf);
    const elDeg = (look.elevation * 180) / Math.PI;

    if (elDeg > 0) {
      if (!inPass) {
        inPass = true;
        passStart = t.getTime();
        peakEl = elDeg;
        peakTime = t.getTime();
      } else if (elDeg > peakEl) {
        peakEl = elDeg;
        peakTime = t.getTime();
      }
    } else if (inPass) {
      passes.push({
        startTime: passStart,
        peakTime,
        endTime: t.getTime(),
        maxElevationDeg: peakEl,
        visibilityScore: scoreVisibility(peakEl, peakTime),
      });
      inPass = false;
      peakEl = -Infinity;
      if (passes.length >= maxPasses) break;
    }
  }

  return passes;
}

function scoreVisibility(maxElevationDeg: number, peakTimeMs: number): number {
  // Higher elevation -> better. Twilight hours -> better (very rough heuristic).
  const elScore = Math.min(1, maxElevationDeg / 60);
  const hour = new Date(peakTimeMs).getHours();
  const twilightBoost =
    hour <= 5 || hour >= 19 ? 0.25 : hour <= 7 || hour >= 17 ? 0.15 : 0;
  return Math.min(1, elScore * 0.85 + twilightBoost);
}
