# Self-hosting AstroTrack

AstroTrack is an open-source, self-hostable 3D satellite tracker. This guide covers everything you need to run it on your own infrastructure.

---

## Requirements

### Prebuilt images (simplest)

- [Docker](https://docs.docker.com/get-docker/) 24+ and [Docker Compose](https://docs.docker.com/compose/) v2 (`docker compose` subcommand, not `docker-compose`).

### Build from source

Everything above, plus:

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/)

---

## Quickstart A — prebuilt images (recommended)

Uses pre-built images published to GitHub Container Registry (`ghcr.io/xops-labs/astrotrack-backend` and `ghcr.io/xops-labs/astrotrack-frontend`). No local build needed.

```bash
# 1. Clone the repo (for compose files and .env.example)
git clone https://github.com/xops-labs/AstroTrack.git
cd AstroTrack

# 2. Create your .env from the template and edit secrets
cp .env.example .env
# Open .env and change POSTGRES_PASSWORD at minimum

# 3. Start the stack
docker compose -f docker-compose.prod.yml up -d

# 4. Open the app
#    Frontend:  http://localhost:8080
#    API:       http://localhost:5080
```

---

## Quickstart B — build from source

Builds backend and frontend Docker images locally.

```bash
git clone https://github.com/xops-labs/AstroTrack.git
cd AstroTrack

# Optional: copy .env to override defaults
cp .env.example .env

docker compose up --build
```

The first build takes a few minutes as it compiles the .NET backend and runs `npm run build` for the frontend.

---

## What runs

| Service    | Description                          | Default port   |
|------------|--------------------------------------|----------------|
| `postgres` | PostgreSQL 16 database               | 5432           |
| `backend`  | .NET 8 API (AstroTrack.Api)          | 5080 (→ 8080 inside container) |
| `frontend` | Nginx-served React/Vite app          | 8080           |

### URLs

| Endpoint             | URL                              |
|----------------------|----------------------------------|
| Frontend app         | http://localhost:8080            |
| Backend API          | http://localhost:5080            |
| Swagger UI (dev only)| http://localhost:5080/swagger    |
| Health check         | http://localhost:5080/healthz    |

> Swagger UI is only available when `ASPNETCORE_ENVIRONMENT=Development`. In `Production` (the default) the `/swagger` route is not served.

---

## Configuration

All runtime configuration is provided via environment variables or a `.env` file in the project root. See **[docs/configuration.md](configuration.md)** for the full reference table and production hardening guidance.

The stack boots with built-in defaults even without a `.env` file. You only need a `.env` to override values (e.g., set a strong `POSTGRES_PASSWORD` for internet-facing deployments).

---

## Enabling observability

The OpenTelemetry stack is **opt-in**. By default, instrumentation is active inside the process but no data is exported anywhere — no collector is required for the app to run.

To enable traces and metrics export:

1. Uncomment `OTEL_EXPORTER_OTLP_ENDPOINT` in your `.env`:

   ```env
   OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
   ```

2. Start the stack with the `observability` profile, which adds the bundled OpenTelemetry Collector:

   ```bash
   docker compose --profile observability up
   ```

   For prebuilt images:

   ```bash
   docker compose -f docker-compose.prod.yml --profile observability up
   ```

The collector listens on port `4317` (gRPC). Configure its output (Jaeger, Grafana Tempo, Prometheus, etc.) via `deploy/otel-collector-config.yaml`.

---

## Database

### Auto-migrations

When `ConnectionStrings__Postgres` is set, the backend automatically applies all pending EF Core migrations on startup before serving traffic. No manual `dotnet ef database update` is required.

If `ConnectionStrings__Postgres` is not set, the backend falls back to an **in-memory catalog** (satellite data lives only in memory, resets on restart). This is useful for quick demos but not suitable for production.

### Backups

**Back up** the Postgres volume with `pg_dump`:

```bash
docker exec astrotrack-postgres-1 \
  pg_dump -U astrotrack astrotrack \
  > backup_$(date +%Y%m%d_%H%M%S).sql
```

Replace `astrotrack-postgres-1` with the actual container name (check with `docker ps`).

**Restore** from a dump:

```bash
# Restore into a running container
cat backup_20260101_120000.sql | \
  docker exec -i astrotrack-postgres-1 \
  psql -U astrotrack -d astrotrack
```

---

## Upgrading

### Prebuilt images

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Built from source

```bash
git pull
docker compose up --build -d
```

In both cases, the backend applies any new EF Core migrations automatically on startup. No manual migration step is needed.

---

## Production hardening checklist

- **Change the default password.** Set `POSTGRES_PASSWORD` to a strong, randomly generated value in `.env`.
- **Lock down CORS.** Set `AstroTrack__Cors__AllowedOrigins__0` to your actual public domain (e.g., `https://astrotrack.example.com`). Remove any `localhost` origins.
- **Terminate TLS with a reverse proxy.** AstroTrack does not handle TLS itself. Place [nginx](https://nginx.org/), [Caddy](https://caddyserver.com/), or [Traefik](https://traefik.io/) in front and proxy to the frontend on port 8080 and the backend API on port 5080.
- **Set `ASPNETCORE_ENVIRONMENT=Production`** (the default in `docker-compose.yml`). This disables Swagger UI and enables production-grade error handling.
- **Do not expose port 5432** (Postgres) to the public internet. The default compose config binds it on all interfaces; in production, remove or restrict the `ports:` entry for the `postgres` service.
- **Use secrets management.** Consider Docker Secrets or a vault (HashiCorp Vault, AWS Secrets Manager) instead of plain `.env` files for credentials.

---

## Troubleshooting

### Port conflicts

If ports 5080, 8080, or 5432 are in use, edit the `ports:` mappings in `docker-compose.yml` (or `docker-compose.prod.yml`) before starting.

### Viewing logs

```bash
# All services
docker compose logs -f

# Backend only
docker compose logs -f backend

# Frontend only
docker compose logs -f frontend

# Postgres only
docker compose logs -f postgres
```

### Backend fails to start / database errors

The backend waits for Postgres to pass its healthcheck before starting (configured with `depends_on: condition: service_healthy`). If the backend still fails, check `ConnectionStrings__Postgres` in your `.env` matches your `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values.

### Migrations fail

Run migrations manually if automatic migration fails on startup:

```bash
docker compose run --rm backend \
  dotnet ef database update \
  --project backend/src/AstroTrack.Infrastructure \
  --startup-project backend/src/AstroTrack.Api
```

### Frontend shows "Cannot connect to API"

The frontend is pre-configured to call the backend at `http://localhost:5080`. If you change the backend port mapping, rebuild the frontend image so Vite bakes the correct API URL.
