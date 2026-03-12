# carbon-trace

<!-- Banner image: add one at public/banner.png or docs/banner.png and uncomment below -->
<!-- ![Banner](./public/banner.png) -->

[![CI](https://github.com/anchildress1/carbon-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/anchildress1/carbon-trace/actions/workflows/ci.yml)
[![License: Polyform Shield](https://img.shields.io/badge/license-Polyform%20Shield-blue)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_carbon-trace&metric=alert_status)](https://sonarcloud.io/project/overview?id=anchildress1_carbon-trace)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_carbon-trace&metric=coverage)](https://sonarcloud.io/project/overview?id=anchildress1_carbon-trace)

An immersive, click-to-advance visual narrative told from the awareness of a diamond trapped in a coal seam. WeCoded 2026 Frontend Art Entry.

## Setup

```bash
# Install dependencies
make install

# Start development server
make dev
```

## Available Commands

| Command            | Description                       |
| ------------------ | --------------------------------- |
| `make install`     | Install all dependencies          |
| `make dev`         | Start development server          |
| `make format`      | Format code                       |
| `make lint`        | Run linter                        |
| `make typecheck`   | Type check (no-op for vanilla JS) |
| `make test`        | Run unit tests                    |
| `make build`       | Production build                  |
| `make e2e`         | Run E2E tests                     |
| `make perf`        | Run performance tests             |
| `make secret-scan` | Scan for secrets                  |
| `make clean`       | Remove build artifacts            |

## License

Polyform Shield License 1.0.0 — see [LICENSE](LICENSE).
