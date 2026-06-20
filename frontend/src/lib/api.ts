import type { SatelliteRecord } from "../types/satellite";
import { fetchSatelliteCatalog } from "./tle";

const API_BASE = "/api";

interface BackendSatellite {
  noradId: number;
  name: string;
  category: SatelliteRecord["category"];
  operator?: string;
  country?: string;
  launchDate?: string;
  orbitType?: SatelliteRecord["orbitType"];
  missionDescription?: string;
  dataSource: string;
  tleLine1: string;
  tleLine2: string;
}

/**
 * Fetch satellite catalog from the backend if reachable; otherwise fall
 * back to direct CelesTrak fetch in the browser. This keeps the frontend
 * usable as a pure static site (classroom / offline mode) but also lets the .NET
 * backend serve cached/curated catalog data when deployed.
 */
export async function loadCatalog(): Promise<SatelliteRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/satellites`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const json = (await res.json()) as BackendSatellite[];
      if (Array.isArray(json) && json.length > 0) return json;
    }
  } catch {
    // Backend not running — fall back to client-side TLE fetch.
  }
  return fetchSatelliteCatalog();
}

export interface MissionRecord {
  id: string;
  name: string;
  agency: string;
  description: string;
  link: string;
  imageUrl?: string;
  noradId?: number;
}

export async function loadMissions(): Promise<MissionRecord[]> {
  try {
    const res = await fetch(`${API_BASE}/missions`);
    if (res.ok) return (await res.json()) as MissionRecord[];
  } catch {
    // ignore
  }
  return EMBEDDED_MISSIONS;
}

const EMBEDDED_MISSIONS: MissionRecord[] = [
  {
    id: "iss",
    name: "International Space Station",
    agency: "NASA / Roscosmos / ESA / JAXA / CSA",
    description:
      "A modular space station in low Earth orbit, hosting continuous crewed presence since November 2000. Conducts microgravity research across biology, physics, astronomy, and Earth observation.",
    link: "https://www.nasa.gov/international-space-station/",
    imageUrl:
      "https://images-assets.nasa.gov/image/iss066e081229/iss066e081229~medium.jpg",
    noradId: 25544,
  },
  {
    id: "hubble",
    name: "Hubble Space Telescope",
    agency: "NASA / ESA",
    description:
      "Optical/UV/near-infrared space telescope launched in 1990. Has produced some of the most detailed visible-light images of the universe, helping refine the age and expansion rate of the cosmos.",
    link: "https://science.nasa.gov/mission/hubble/",
    imageUrl:
      "https://images-assets.nasa.gov/image/hubble-sees-the-wings-of-a-butterfly-the-twin-jet-nebula_20283986193_o/hubble-sees-the-wings-of-a-butterfly-the-twin-jet-nebula_20283986193_o~medium.jpg",
    noradId: 20580,
  },
  {
    id: "jpss",
    name: "Joint Polar Satellite System (NOAA-20 / JPSS-1)",
    agency: "NOAA / NASA",
    description:
      "Polar-orbiting weather and Earth observation constellation that provides global atmospheric and surface data twice per day. Critical input to numerical weather prediction.",
    link: "https://www.nesdis.noaa.gov/our-satellites/currently-flying/joint-polar-satellite-system",
    noradId: 43013,
  },
  {
    id: "landsat-9",
    name: "Landsat 9",
    agency: "NASA / USGS",
    description:
      "Continues the longest-running enterprise for acquisition of multispectral satellite imagery of Earth's land surface. Used in agriculture, forestry, water resources, and climate science.",
    link: "https://landsat.gsfc.nasa.gov/satellites/landsat-9/",
  },
];
