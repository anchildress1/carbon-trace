# carbon-trace

<!-- Banner image: add one at public/banner.png or docs/banner.png and uncomment below -->
<!-- ![Banner](./public/banner.png) -->

[![CI](https://github.com/anchildress1/carbon-trace/actions/workflows/ci.yml/badge.svg)](https://github.com/anchildress1/carbon-trace/actions/workflows/ci.yml)
[![License: Polyform Shield](https://img.shields.io/badge/license-Polyform%20Shield-blue)](LICENSE)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_carbon-trace&metric=alert_status)](https://sonarcloud.io/project/overview?id=anchildress1_carbon-trace)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=anchildress1_carbon-trace&metric=coverage)](https://sonarcloud.io/project/overview?id=anchildress1_carbon-trace)

An immersive visual narrative told from the awareness of a diamond trapped in a coal seam. Navigate scenes via buttons, keyboard, or progress dots. WeCoded 2026 Frontend Art Entry.

Built with Vite, vanilla JavaScript (ES modules), GSAP animations, and Howler.js audio. Deployed as a static site to Cloud Run.

## Controls

| Control                 | Action                                               |
| ----------------------- | ---------------------------------------------------- |
| **Prev / Next** buttons | Navigate between scenes                              |
| **Arrow Left / Right**  | Navigate between scenes                              |
| **Space**               | Toggle play/pause                                    |
| **Enter / Arrow Right** | Advance to next scene                                |
| **Pause** button        | Freeze/resume all audio, animations, and captions    |
| **Mute** button         | Toggle audio mute                                    |
| **Captions** button     | Toggle subtitle display (persists across sessions)   |
| **Replay** button       | Restart current scene's narration from the beginning |
| **Progress dots**       | Jump to a specific scene                             |

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

## Architecture

See [docs/architecture.md](docs/architecture.md) for module dependency graph, state machine diagram, and data flow.

## Accessibility

WCAG AA compliant. See [docs/accessibility.md](docs/accessibility.md) for details on screen reader support, keyboard navigation, reduced motion handling, and contrast compliance.

## Audio System

See [docs/audio-system.md](docs/audio-system.md) for narration pipeline, pause/resume mechanics, crossfade algorithm, and error handling.

## License

Polyform Shield License 1.0.0 — see [LICENSE](LICENSE).
