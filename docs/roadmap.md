# Product roadmap

> **AstroTrack is open-source under the MIT License and fully self-hostable.** The project ships as a Docker Compose stack (prebuilt images or build-from-source). Self-hosting documentation lives in [docs/self-hosting.md](self-hosting.md).

## v0.1 — MVP (this build)

- 3D globe with rotating Earth, atmosphere, stars
- ~600-satellite catalog from CelesTrak (multi-category)
- SGP4 propagation client-side (browser) and server-side (.NET)
- Search, category filter, favorites (localStorage)
- Detail panel: live position, mission metadata, orbit trail
- Pass prediction with `.ics` calendar export
- Curated NASA mission explorer
- .NET 8 clean architecture, OpenTelemetry, Docker Compose
- Unit tests for TLE parser and propagator

## v0.2 — Persistence + auth

- Replace `InMemorySatelliteCatalog` with EF Core + Postgres
- Hangfire for TLE refresh (vs current `BackgroundService`)
- Auth0 or Azure AD B2C; move favorites and saved location server-side
- Email pass alerts (SendGrid)

## v0.3 — Education & engagement

- Historical replay (scrub through time, see ISS yesterday)
- Day/night terminator overlay using sun position
- Ground tracks (footprint on Earth)
- Educational tooltips ("what is sun-synchronous orbit?")
- Classroom mode: lesson templates, teacher dashboard
- Student-satellite spotlight: highlight CubeSats / university missions and share a link to your own satellite

## v0.4 — Premium tier

- Web push notifications for upcoming passes
- Constellation browser (Starlink, Iridium NEXT, GPS)
- API tier with usage-based pricing
- White-label / classroom kiosk theme

## v0.5 — Mobile + AR

- React Native or Capacitor wrapper
- AR sky view (point phone at sky → see what's overhead)
- Background notifications for ISS overhead

## Beyond

- Conjunction analysis (visualise close approaches)
- Live debris tracking
- Mission control dashboard (telemetry feeds for partner missions)
