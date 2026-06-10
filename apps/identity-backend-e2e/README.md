# E2E Test Suite

> End-to-end tests that run the entire stack — blockchain mock, API server, and PostgreSQL — inside Docker containers.

## Why

These tests verify the full system works together: Chopsticks mocks the Polkadot People chain, the backend API processes username registrations, and PostgreSQL persists state. Running everything in Docker means tests are hermetic — no external dependencies, no shared state between runs.

## Quick Start

### Prerequisites

- Docker running locally
- All E2E Docker images built (run once):

```bash
./docker/test/e2e/build-local.sh
```

### Run tests

```bash
# Run the full suite locally (parallel, ~3 minutes; rebuilds Docker images automatically)
bash scripts/e2e-local.sh

# Run a single test file locally
bash scripts/e2e-local.sh tests/swagger.test.ts
```

## How It Works

Each test file gets its own isolated world:

1. **Chopsticks** spins up a mock Substrate chain at a fixed block height
2. **Startup container** funds test accounts and seeds blockchain state
3. **Web container** starts the API server connected to the mock chain
4. **IntegreSQL** provides a fresh PostgreSQL database cloned from a template

Tests use Vitest with 4 workers, each running a separate Docker Compose environment. This parallelism is safe because each worker's containers live in a separate Docker project namespace.

## Architecture at a Glance

| Component       | Technology       | Role                             |
| --------------- | ---------------- | -------------------------------- |
| Blockchain mock | Acala Chopsticks | Polkadot People chain mock       |
| API server      | Bun + Hono       | Identity backend container       |
| Database        | PostgreSQL 15    | Per-test isolated via IntegreSQL |
| Orchestration   | testcontainers   | Docker Compose lifecycle         |

## OpenTelemetry Traces

The suite supports optional OTEL trace capture for debugging flakes and performance issues. Enable with `OTEL_ENABLED=true`:

```bash
OTEL_ENABLED=true bash scripts/e2e-local.sh
```

Traces are written to a Docker volume and can be extracted after the run. For full details on trace extraction, replay, and programmatic parsing, see the [E2E Testing Guide](../../docs/E2E_TESTING_GUIDE.md).

## Troubleshooting

**"Health check failed: unhealthy"**

The API container exited during startup. Check its logs — usually a Drizzle migration failure or missing environment variable.

## File Layout

```
vitest.config.ts            # Worker count, retry, timeout
vitest.global-setup.ts      # One-time image build + IntegreSQL start
vitest.setup.ts             # OTEL collector lifecycle, per-file setup
otel.ts                     # OTEL SDK configuration
tests/
├── helpers.ts              # Mnemonic generation, funding, assertions
├── setup.ts                # Docker Compose + IntegreSQL bootstrap
└── v1/                     # API v1 tests (username, DIM ticket, etc.)
```

## Contributing

See the root [`CONTRIBUTING.md`](/CONTRIBUTING.md) for project-wide guidelines.
