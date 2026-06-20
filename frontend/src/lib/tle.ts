import type { SatelliteCategory, SatelliteRecord } from "../types/satellite";

const CELESTRAK_BASE = "https://celestrak.org/NORAD/elements/gp.php";

interface CelesTrakGroup {
  group: string;
  category: SatelliteCategory;
  operatorHint?: string;
}

const GROUPS: CelesTrakGroup[] = [
  { group: "stations", category: "iss" },
  { group: "weather", category: "weather" },
  { group: "noaa", category: "weather", operatorHint: "NOAA" },
  { group: "goes", category: "weather", operatorHint: "NOAA" },
  { group: "resource", category: "earth-observation" },
  { group: "sarsat", category: "earth-observation" },
  // Student-built and university satellites: CubeSats, education missions,
  // and amateur-radio satellites. Listed before "active" so they are not
  // capped out by the generic superset.
  { group: "cubesat", category: "cubesat" },
  { group: "education", category: "cubesat" },
  { group: "amateur", category: "cubesat" },
  { group: "active", category: "other" },
  { group: "starlink", category: "communication", operatorHint: "SpaceX" },
  { group: "iridium-NEXT", category: "communication", operatorHint: "Iridium" },
  { group: "gps-ops", category: "navigation", operatorHint: "USAF" },
  { group: "galileo", category: "navigation", operatorHint: "ESA" },
  { group: "science", category: "science" },
];

export interface TleSourceOptions {
  /** Limit total satellites returned across groups (perf cap). */
  maxTotal?: number;
  /** Limit per group to keep variety. */
  maxPerGroup?: number;
  /** Override fetch (for tests). */
  fetcher?: typeof fetch;
}

/**
 * Fetch TLEs from CelesTrak across multiple categories and merge them
 * into a deduplicated catalog. Falls back to a tiny embedded sample if
 * the network is unavailable, so the app stays usable offline.
 */
export async function fetchSatelliteCatalog(
  options: TleSourceOptions = {}
): Promise<SatelliteRecord[]> {
  const { maxTotal = 600, maxPerGroup = 80, fetcher = fetch } = options;
  const seen = new Map<number, SatelliteRecord>();

  await Promise.all(
    GROUPS.map(async (g) => {
      try {
        const url = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(g.group)}&FORMAT=tle`;
        const res = await fetcher(url, { headers: { Accept: "text/plain" } });
        if (!res.ok) return;
        const text = await res.text();
        const records = parseTleText(text, {
          category: g.category,
          dataSource: `CelesTrak/${g.group}`,
          operator: g.operatorHint,
        });
        for (const r of records.slice(0, maxPerGroup)) {
          if (!seen.has(r.noradId)) {
            seen.set(r.noradId, r);
          } else if (g.category !== "other") {
            // Prefer specific categories over the generic "active" bucket
            const existing = seen.get(r.noradId)!;
            if (existing.category === "other") seen.set(r.noradId, r);
          }
          if (seen.size >= maxTotal) return;
        }
      } catch {
        // Ignore per-group failures; continue with other groups.
      }
    })
  );

  if (seen.size === 0) {
    return EMBEDDED_FALLBACK_TLES;
  }

  const catalog = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return catalog.slice(0, maxTotal);
}

interface ParseOptions {
  category: SatelliteCategory;
  dataSource: string;
  operator?: string;
}

export function parseTleText(text: string, opts: ParseOptions): SatelliteRecord[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const out: SatelliteRecord[] = [];
  for (let i = 0; i < lines.length - 2; i += 1) {
    const name = lines[i].trim();
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!name || !l1?.startsWith("1 ") || !l2?.startsWith("2 ")) continue;
    const noradId = Number.parseInt(l1.slice(2, 7).trim(), 10);
    if (!Number.isFinite(noradId)) continue;
    out.push({
      noradId,
      name,
      category: opts.category,
      operator: opts.operator,
      orbitType: classifyOrbitFromTle(l2),
      dataSource: opts.dataSource,
      tleLine1: l1,
      tleLine2: l2,
    });
    i += 2;
  }
  return out;
}

/**
 * Quick orbit classification from TLE mean motion (revolutions per day).
 * GEO ~ 1, MEO ~ 2, LEO > 11. Polar/SSO inferred from inclination.
 */
function classifyOrbitFromTle(line2: string): SatelliteRecord["orbitType"] {
  const meanMotion = Number.parseFloat(line2.slice(52, 63));
  const inclination = Number.parseFloat(line2.slice(8, 16));
  if (!Number.isFinite(meanMotion)) return "Unknown";
  if (meanMotion < 1.5) return "GEO";
  if (meanMotion < 5) return "MEO";
  if (Number.isFinite(inclination)) {
    if (inclination >= 96 && inclination <= 100) return "SSO";
    if (inclination > 80) return "Polar";
  }
  return "LEO";
}

/**
 * Minimal embedded fallback so the app boots even if CelesTrak is unreachable.
 * These are well-known objects; positions will be approximate until refresh.
 */
export const EMBEDDED_FALLBACK_TLES: SatelliteRecord[] = [
  {
    noradId: 25544,
    name: "ISS (ZARYA)",
    category: "iss",
    operator: "NASA / Roscosmos / ESA / JAXA / CSA",
    country: "International",
    launchDate: "1998-11-20",
    orbitType: "LEO",
    missionDescription: "International Space Station — crewed orbital laboratory.",
    dataSource: "embedded-fallback",
    tleLine1: "1 25544U 98067A   24001.50000000  .00012345  00000-0  22000-3 0  9990",
    tleLine2: "2 25544  51.6400 100.0000 0006000  90.0000 270.0000 15.50000000300000",
  },
  {
    noradId: 20580,
    name: "HST (HUBBLE SPACE TELESCOPE)",
    category: "science",
    operator: "NASA / ESA",
    country: "USA",
    launchDate: "1990-04-24",
    orbitType: "LEO",
    missionDescription: "Optical/UV/near-IR space telescope in low Earth orbit.",
    dataSource: "embedded-fallback",
    tleLine1: "1 20580U 90037B   24001.50000000  .00001500  00000-0  10000-3 0  9990",
    tleLine2: "2 20580  28.4690 280.0000 0002500  90.0000 270.0000 15.10000000300000",
  },
  {
    noradId: 43013,
    name: "NOAA 20 (JPSS-1)",
    category: "weather",
    operator: "NOAA",
    country: "USA",
    launchDate: "2017-11-18",
    orbitType: "SSO",
    missionDescription: "Polar-orbiting weather and Earth observation satellite.",
    dataSource: "embedded-fallback",
    tleLine1: "1 43013U 17073A   24001.50000000  .00000050  00000-0  35000-4 0  9990",
    tleLine2: "2 43013  98.7500 200.0000 0001200  90.0000 270.0000 14.20000000300000",
  },
  {
    noradId: 39444,
    name: "FUNCUBE-1 (AO-73)",
    category: "cubesat",
    operator: "AMSAT-UK / educational",
    country: "International",
    launchDate: "2013-11-21",
    orbitType: "SSO",
    missionDescription:
      "Educational 1U CubeSat with an amateur-radio transponder, built for STEM outreach in schools and universities.",
    dataSource: "embedded-fallback",
    tleLine1: "1 39444U 13066AE  24001.50000000  .00000800  00000-0  12000-3 0  9990",
    tleLine2: "2 39444  97.6000 100.0000 0050000  90.0000 270.0000 14.78000000300000",
  },
];
