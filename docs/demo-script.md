# Demo script (≈ 5 minutes)

Designed for a live demo to a non-technical audience — a classroom, a science club, or a student-satellite team's outreach session.

## 0 — open the app

> "AstroTrack shows every active satellite in low Earth orbit, in real time, in 3D."

The globe loads with a few hundred markers orbiting a stylised Earth. Stars rotate softly behind it. Each colour is a satellite category.

## 1 — find the ISS

1. Type `ISS` in the search box.
2. Click `ISS (ZARYA)` in the list.
3. Detail panel opens on the right with **live latitude, longitude, altitude (~420 km), and speed (~7.7 km/s)**.
4. The orange ring on the globe pulses around the ISS. A cyan polyline traces the next full orbit.

> "These numbers are computed by SGP4 — the same orbital model NASA uses — running directly in your browser at 60 fps. We update positions every animation frame."

## 2 — predict a visible pass

1. In the detail panel under **Upcoming passes**, click **Use my location** (or pick a preset like *New York*).
2. The next 5 passes appear with start time, duration, peak elevation, and a visibility score.
3. Click **Add to calendar** on a high-elevation pass — it downloads an `.ics` file you can open in Outlook/Google Calendar.

> "Twilight passes score higher because that's when you can see the ISS with the naked eye — sun on the spacecraft, dark sky on the ground."

## 3 — explore mission context

1. Click **NASA Missions** in the top right.
2. Browse mission profiles for ISS, Hubble, NOAA-20, Landsat 9.
3. Click **Track on globe** on Hubble — the panel closes and the globe selects HST.

## 4 — filter to the constellations

1. Close the detail panel.
2. Click the **Comms** category pill — only Starlink and Iridium satellites are shown. The globe re-renders with hundreds of pink markers.
3. Click **All** to bring everything back.

## 5 — favorites + offline mode

1. Star the ISS and Hubble using the ☆ button.
2. Toggle **Favorites only**.
3. (Optional) Disable WiFi. Reload. The app still works using the embedded fallback TLEs and your saved favorites — perfect for a classroom or lab with flaky WiFi.

## Talking points

- TLEs come from **CelesTrak** (public data), refreshed every 6 hours by a backend worker.
- Backend is **.NET 8 clean architecture**. Swap in Postgres + EF Core via DI without touching API code.
- Observability is **OpenTelemetry** out of the box — metrics, traces, logs.
- Frontend is **React + Three.js**, runs as a static SPA, deployable to S3/Cloudflare Pages/Azure Static Web Apps.
