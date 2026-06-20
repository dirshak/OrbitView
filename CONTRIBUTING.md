# Contributing to AstroTrack

Thank you for your interest in contributing. AstroTrack is an open-source project released under the MIT license, and all contributions are accepted under the same license.

Please read this document before opening issues or pull requests. Also read our [Code of Conduct](CODE_OF_CONDUCT.md).

---

## Prerequisites

You need one of the following setups:

**Option A — Docker (recommended)**
- Docker Desktop 4.x or newer with Compose V2

**Option B — Local toolchain**
- .NET 8 SDK
- Node.js 20 LTS
- (Optional) a PostgreSQL instance if you want persistent storage outside the Docker compose stack

---

## Running the app locally

### Docker (single command)

```bash
docker compose up --build
```

The API will be available at `http://localhost:5080` and the frontend at `http://localhost:5173`.

### Without Docker

**Backend**

```bash
cd backend/src/AstroTrack.Api
dotnet run
```

The API listens on `http://localhost:5080` by default.

**Frontend**

```bash
cd frontend
npm install
npm run dev
```

The dev server starts at `http://localhost:5173` and proxies `/api` requests to the backend.

---

## Running tests

**Backend**

```bash
dotnet test backend/AstroTrack.sln
```

**Frontend**

```bash
cd frontend
npm test
```

`npm test` runs `vitest run` — it executes once and exits, making it safe for CI.

To run in watch mode during development:

```bash
npm run test:watch
```

---

## Code style notes

- The project follows **Clean Architecture** principles. Keep domain logic out of infrastructure and presentation layers.
- The SGP4 propagation contract (mean motion, inclination, eccentricity interpretation) is intentionally **mirrored between the C# backend and the TypeScript frontend**. If you change orbit-classification logic on one side, update the other to stay in sync.
- TypeScript: strict mode is enabled. Do not disable it or add `// @ts-ignore` without explanation.
- C#: nullable reference types are enabled. Follow existing patterns for null handling.
- Run `npm run typecheck` in `frontend/` before submitting to catch type errors without a full build.

---

## Branching and pull requests

1. Fork the repository and create a branch from `master`:
   ```
   git checkout -b feat/your-feature-name
   ```
2. Make focused commits. Each commit should be self-contained and build cleanly.
3. Open a pull request against `master`. Fill in the pull request template.
4. **CI must pass** before a PR can be merged. Fix any failures in your branch before requesting review.
5. At least one maintainer review is required.
6. Squash or rebase as appropriate before merge — prefer a clean linear history.

---

## License

By contributing you agree that your contributions will be licensed under the [MIT License](LICENSE).
