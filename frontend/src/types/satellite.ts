export type SatelliteCategory =
  | "iss"
  | "earth-observation"
  | "weather"
  | "communication"
  | "science"
  | "navigation"
  | "cubesat"
  | "other";

export interface SatelliteRecord {
  noradId: number;
  name: string;
  category: SatelliteCategory;
  operator?: string;
  country?: string;
  launchDate?: string;
  orbitType?: "LEO" | "MEO" | "GEO" | "HEO" | "SSO" | "Polar" | "Unknown";
  missionDescription?: string;
  dataSource: string;
  tleLine1: string;
  tleLine2: string;
}

export interface SatellitePosition {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  velocityKmS: number;
  timestamp: number; // ms epoch
}

export interface PassWindow {
  startTime: number;
  peakTime: number;
  endTime: number;
  maxElevationDeg: number;
  visibilityScore: number;
}
