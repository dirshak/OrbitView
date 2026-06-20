# Security Policy

AstroTrack is pre-1.0 software. Security fixes are applied to `master` until stable release branches exist.

## Supported Versions

| Version | Supported |
| --- | --- |
| `master` (rolling) | ✅ — all security fixes land here first |
| Latest tagged release | ✅ — receives backported security fixes during the pre-1.0 window |
| Older tagged releases | ❌ — please upgrade |

Pre-1.0, we do not maintain long-lived release branches; once `v1.0.0` is cut, this table will be expanded to cover supported minor versions. We recommend always running the [latest release](https://github.com/xops-labs/AstroTrack/releases/latest).

## Reporting a Vulnerability

Please report security vulnerabilities **privately** using GitHub's [Private Vulnerability Advisories](https://github.com/xops-labs/AstroTrack/security/advisories/new), or by emailing **yasvanth@live.in**. This keeps the report confidential between you and the maintainer until a fix is coordinated.

Do not open a public issue, pull request, or discussion containing reproducers, exploit details, or other sensitive findings — once published, that information is publicly indexed and cannot be retracted.

**What to expect:**

- **Acknowledgement** — within 5 business days.
- **Initial assessment and triage** — within 10 business days, including a severity rating and a target remediation window.
- **Coordinated disclosure** — once a fix is available and users have had a reasonable upgrade window, we publish a [GitHub Security Advisory](https://github.com/xops-labs/AstroTrack/security/advisories) with credit to the reporter unless anonymity is requested.

As a pre-1.0, solo-maintained project, response times are best-effort; we will keep you updated through the advisory thread.

## Scope

Security-sensitive areas include:

- **Database credentials** — the PostgreSQL username/password supplied via `ConnectionStrings__Postgres` and the `POSTGRES_*` environment variables. The shipped defaults (`astrotrack`/`astrotrack`) are for local development only and **must be changed before any non-local deployment**.
- **API surface** — the ASP.NET Core endpoints exposed by `AstroTrack.Api` (satellites, missions, users, `/healthz`, Swagger). Treat these as operational and place them behind your normal network controls or an authenticating reverse proxy when exposed.
- **CORS configuration** — `AstroTrack__Cors__AllowedOrigins__*` controls which web origins may call the API; an overly broad value is a security-relevant misconfiguration.
- **Outbound fetches** — the CelesTrak TLE provider performs outbound HTTP requests; SSRF-style or response-parsing issues in the ingestion path are in scope.
- **OTLP egress** — telemetry export endpoints configured via `OTEL_EXPORTER_OTLP_ENDPOINT` may carry headers/credentials; these must never be logged.
- **Container artifacts** — the backend and frontend Dockerfiles, the published GHCR images, and the release workflow at [.github/workflows/release.yml](.github/workflows/release.yml).
- **Deployment examples** — `docker-compose.yml` and `docker-compose.prod.yml`.

## Safe Harbor

We support **safe harbor** for security research conducted in good faith. If you:

- Make a good-faith effort to avoid privacy violations, data destruction, and service degradation;
- Test only against **your own** deployments of AstroTrack — never against other people's instances or endpoints;
- Avoid exfiltrating data beyond the minimum needed to prove the vulnerability, and do not retain it longer than necessary;
- Give us a reasonable window to remediate before any public disclosure;

then we will not pursue or support any legal action against you, and we will treat your report as authorized testing for the purposes of applicable computer-misuse legislation in your jurisdiction.

This safe-harbor commitment does **not** extend to third-party services AstroTrack integrates with — CelesTrak, NASA endpoints, OTLP backends, or container registries. Their policies apply when testing against them.
