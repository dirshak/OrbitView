-- AstroTrack initial schema (PostgreSQL).
-- Apply via Flyway, dotnet ef, psql -f, or your tool of choice.

CREATE TABLE IF NOT EXISTS satellites (
    id                  UUID PRIMARY KEY,
    norad_id            INTEGER UNIQUE NOT NULL,
    name                TEXT NOT NULL,
    category            TEXT NOT NULL,
    operator            TEXT,
    country             TEXT,
    launch_date         DATE,
    orbit_type          TEXT,
    tle_line1           TEXT NOT NULL,
    tle_line2           TEXT NOT NULL,
    mission_description TEXT,
    data_source         TEXT NOT NULL,
    last_updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS satellites_category_idx ON satellites(category);
CREATE INDEX IF NOT EXISTS satellites_name_idx ON satellites(LOWER(name));

CREATE TABLE IF NOT EXISTS satellite_positions (
    id              UUID PRIMARY KEY,
    satellite_id    UUID NOT NULL REFERENCES satellites(id) ON DELETE CASCADE,
    timestamp       TIMESTAMPTZ NOT NULL,
    latitude_deg    DOUBLE PRECISION NOT NULL,
    longitude_deg   DOUBLE PRECISION NOT NULL,
    altitude_km     DOUBLE PRECISION NOT NULL,
    velocity_km_s   DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS satellite_positions_sat_idx
    ON satellite_positions(satellite_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS user_profiles (
    id                  UUID PRIMARY KEY,
    email               TEXT UNIQUE NOT NULL,
    display_name        TEXT,
    default_latitude    DOUBLE PRECISION,
    default_longitude   DOUBLE PRECISION,
    default_city        TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_favorites (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    norad_id    INTEGER NOT NULL,
    UNIQUE (user_id, norad_id)
);

CREATE TABLE IF NOT EXISTS pass_predictions (
    id                  UUID PRIMARY KEY,
    user_id             UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
    norad_id            INTEGER NOT NULL,
    start_time          TIMESTAMPTZ NOT NULL,
    peak_time           TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    max_elevation_deg   DOUBLE PRECISION NOT NULL,
    visibility_score    DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS pass_predictions_user_idx
    ON pass_predictions(user_id, start_time DESC);
