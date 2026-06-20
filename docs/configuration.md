# Configuration reference

AstroTrack is configured entirely through environment variables. Variables can be set in a `.env` file in the project root (loaded by Docker Compose) or passed directly to the container runtime.

The stack starts with safe built-in defaults even without any `.env` file. See `.env.example` for a ready-to-copy template.

ASP.NET Core uses double-underscore (`__`) as the hierarchy separator in environment variables, mapping to `Colon:Nested:Keys` in `appsettings.json`.

---

## Environment variable reference

### Postgres (database service)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_USER` | `astrotrack` | PostgreSQL superuser name created on first boot. |
| `POSTGRES_PASSWORD` | `astrotrack` | Password for `POSTGRES_USER`. **Change this before exposing the stack to the internet.** |
| `POSTGRES_DB` | `astrotrack` | Name of the default database created on first boot. |

### Backend connection strings

| Variable | Default | Description |
|---|---|---|
| `ConnectionStrings__Postgres` | `Host=postgres;Database=astrotrack;Username=astrotrack;Password=astrotrack` | Full Npgsql connection string consumed by the backend. Must match the `POSTGRES_*` values above. When this variable is unset or empty, the backend falls back to an in-memory catalog (data resets on restart). |
| `ConnectionStrings__Redis` | *(unset)* | **Reserved — not yet used.** Redis is planned for position caching but not implemented. The Redis service is commented out in `docker-compose.yml`. Do not set this variable unless you have enabled the redis service in the compose file. |

### Backend runtime

| Variable | Default | Description |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Production` | ASP.NET Core environment name. Set to `Development` to enable Swagger UI at `/swagger` and verbose error responses. Leave as `Production` for all internet-facing deployments. |

### CORS

| Variable | Default | Description |
|---|---|---|
| `AstroTrack__Cors__AllowedOrigins__0` | `http://localhost:8080` | First allowed CORS origin. Set to the public URL of your frontend (e.g., `https://astrotrack.example.com`). |
| `AstroTrack__Cors__AllowedOrigins__1` | `http://localhost:5173` | Second allowed CORS origin. Used for local Vite dev server. Remove or leave blank in production. |

Additional origins can be added as `AstroTrack__Cors__AllowedOrigins__2`, `__3`, etc. (zero-indexed array).

### OpenTelemetry (opt-in)

OTel instrumentation (tracing and metrics) is always active inside the process. Export to an OTLP collector is **opt-in**: leaving `OTEL_EXPORTER_OTLP_ENDPOINT` unset means no data leaves the process.

| Variable | Default | Description |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | *(unset)* | gRPC endpoint of your OpenTelemetry Collector (e.g., `http://otel-collector:4317`). When unset, OTLP export is disabled and the app runs normally with no external dependency. |
| `OTEL_SERVICE_NAME` | `astrotrack-api` | Service name reported in all telemetry. Override if you run multiple instances. |
| `OTEL_RESOURCE_ATTRIBUTES` | `service.namespace=astrotrack,deployment.environment=local` | Comma-separated key=value resource attributes attached to every span and metric. Update `deployment.environment` to reflect your environment (e.g., `production`). |

To enable the bundled OTel Collector, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317` and start with `--profile observability`:

```bash
docker compose --profile observability up
```

---

## Example .env

```env
# Postgres
POSTGRES_USER=astrotrack
POSTGRES_PASSWORD=change-me-in-production
POSTGRES_DB=astrotrack

# Backend
ConnectionStrings__Postgres=Host=postgres;Database=astrotrack;Username=astrotrack;Password=change-me-in-production
ASPNETCORE_ENVIRONMENT=Production

# CORS — replace with your public domain
AstroTrack__Cors__AllowedOrigins__0=https://astrotrack.example.com

# OpenTelemetry (opt-in — uncomment to enable)
# OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317
```

---

## Production hardening

The following changes are required before running AstroTrack in any internet-facing environment.

1. **Set a strong `POSTGRES_PASSWORD`.** The default `astrotrack` password is only safe on localhost. Generate a random password and update both `POSTGRES_PASSWORD` and `ConnectionStrings__Postgres`.

2. **Restrict CORS origins.** Remove `http://localhost:5173` from `AstroTrack__Cors__AllowedOrigins__1` (or leave it unset) and set `AstroTrack__Cors__AllowedOrigins__0` to your actual public domain with the correct scheme (`https://`).

3. **Set `ASPNETCORE_ENVIRONMENT=Production`.** This is the default in `docker-compose.yml` but confirm it is set. This disables Swagger UI and enables production-grade exception handling (no stack traces leaked to clients).

4. **Terminate TLS externally.** AstroTrack does not handle HTTPS. Place a reverse proxy (nginx, Caddy, or Traefik) in front that terminates TLS and forwards to the frontend on port 8080 and the backend on port 5080.

5. **Do not publish port 5432 publicly.** Remove or restrict the `ports:` entry for the `postgres` service so the database is not reachable from outside the Docker network.

6. **Use secrets management.** Avoid committing `.env` files with real credentials. Consider Docker Secrets, HashiCorp Vault, or your cloud provider's secret store (AWS Secrets Manager, Azure Key Vault).

7. **Set meaningful OTel resource attributes.** If you enable telemetry, update `OTEL_RESOURCE_ATTRIBUTES` so `deployment.environment` reflects the actual environment (e.g., `service.namespace=astrotrack,deployment.environment=production`).
