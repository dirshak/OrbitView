# AstroTrack API

Base URL: `http://localhost:5080` (dev) · `http://localhost:8080` (docker)

All responses are JSON. `noradId` uniquely identifies a satellite.

## Satellites

### `GET /api/satellites`

Returns the full catalog (currently in-memory, refreshed from CelesTrak every 6h).

```json
[
  {
    "noradId": 25544,
    "name": "ISS (ZARYA)",
    "category": "iss",
    "operator": "NASA / Roscosmos / ESA / JAXA / CSA",
    "country": "International",
    "launchDate": "1998-11-20",
    "orbitType": "LEO",
    "missionDescription": "International Space Station — crewed orbital laboratory.",
    "dataSource": "CelesTrak/stations",
    "tleLine1": "1 25544U ...",
    "tleLine2": "2 25544 ..."
  }
]
```

### `GET /api/satellites/{noradId}`

Returns a single satellite or `404`.

### `GET /api/satellites/{noradId}/position`

Current SGP4-propagated position. Useful for clients that prefer server-side compute or for non-WebGL consumers.

```json
{
  "noradId": 25544,
  "timestamp": "2026-05-04T12:34:56Z",
  "latitudeDeg": -14.21,
  "longitudeDeg": 132.55,
  "altitudeKm": 416.3,
  "velocityKmS": 7.66
}
```

### `GET /api/satellites/{noradId}/orbit?samples=180`

Pre-computed orbit polyline for the next full revolution. `samples` is clamped to `[16, 720]`.

### `GET /api/satellites/{noradId}/passes?lat=&lon=&heightKm=&hours=48&maxPasses=5`

Returns up to `maxPasses` upcoming passes over an observer location. Visibility score in `[0,1]` blends max elevation with a twilight heuristic.

```json
[
  {
    "startTime": "2026-05-04T19:14:00Z",
    "peakTime":  "2026-05-04T19:18:30Z",
    "endTime":   "2026-05-04T19:24:00Z",
    "maxElevationDeg": 62.4,
    "visibilityScore": 0.82
  }
]
```

## Missions

- `GET /api/missions` — curated mission profiles (NASA / NOAA).
- `GET /api/missions/{id}` — single mission.
- `GET /api/missions/{id}/images` — image URLs.

## Users (stub)

> Production: replace with proper auth (Auth0 / Azure AD B2C) and a Postgres-backed user repository. Today the controller keys state by an optional `X-User-Id` header.

- `POST /api/users/location` — body: `{ "latitude": 40.7, "longitude": -74.0, "city": "New York" }`.
- `GET /api/users/favorites` — list of NORAD ids.
- `POST /api/users/favorites/{noradId}` — add favorite.
- `DELETE /api/users/favorites/{noradId}` — remove favorite.

## Health

- `GET /healthz` — liveness probe.
