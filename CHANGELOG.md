# Changelog

All notable changes to AstroTrack are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-18

### Added

- Initial open-source release under the MIT license.
- Self-hostable deployment via Docker Compose (`docker-compose.prod.yml`) — pull prebuilt images from GHCR and be running in under five minutes.
- Prebuilt container images published to GitHub Container Registry:
  - `ghcr.io/xops-labs/astrotrack-backend:latest`
  - `ghcr.io/xops-labs/astrotrack-frontend:latest`
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) covering .NET 8 build/test, frontend typecheck/test/build, and Docker smoke builds on every push to `master` and every pull request.
- GitHub Actions release workflow (`.github/workflows/release.yml`) that builds and pushes versioned GHCR images on `v*` tag pushes.
- Dependabot configuration for automated dependency updates across NuGet, npm, GitHub Actions, and Docker base images.
- Contributor documentation (`CONTRIBUTING.md`) and community health files.
- Optional OpenTelemetry observability stack via `docker compose --profile observability up`.

### Changed

- Relicensed from proprietary to MIT.
- Standalone stack: all services (Postgres, backend API, frontend) are fully defined in the Compose files with no external dependencies required.

### Removed

- Dependency on the private `platform-infra_default` external Docker network; the production Compose file uses only an internally managed volume and the default bridge network.

[Unreleased]: https://github.com/xops-labs/AstroTrack/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/xops-labs/AstroTrack/releases/tag/v0.1.0
