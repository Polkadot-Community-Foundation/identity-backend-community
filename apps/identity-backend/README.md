> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

<div align="center">

# Polkadot App Backend

_The server-side half of the Polkadot mobile app. It registers usernames on the People Chain, verifies device identity, and delivers push notifications._

</div>

You need server-side infrastructure for the Polkadot mobile app. Users want to register human-readable names, prove their device is genuine, and get notified when something happens on-chain. This service handles all three, talking to the People Chain via WSS and to Apple/Google push gateways.

It does not hold user keys — all signing happens on the device. It does not route encrypted chat messages — those travel on-chain. It issues JWT session tokens, not blockchain keys.

## Quick Start

Install [Bun](https://bun.sh), [pnpm](https://pnpm.io) (via corepack), and [Docker](https://www.docker.com). Then:

```bash
corepack enable
corepack pnpm install

docker run -d --name identity-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=identity \
  -p 5432:5432 postgres:18

cp apps/identity-backend/.env.example apps/identity-backend/.env
pnpm --filter identity-backend-container db:migrate
pnpm --filter identity-backend-container dev
```

The server starts at `http://localhost:8080`. Hit the health check:

```bash
curl http://localhost:8080/healthcheck
# {"status":"ok"}
```

Local dev defaults disable auth (`AUTH_ENABLED=false`). Read `apps/identity-backend/.env.example` to configure chain endpoints, Apple/Google credentials, and push notification keys.

## Endpoints

All routes live under `/api/v1/`.

**Auth** — IOS devices attest with [Apple App Attest](https://developer.apple.com/documentation/devicecheck), Android with [Google Play Integrity](https://developer.android.com/google/play/integrity) or Keystore attestation. Successful attestation returns a JWT.

| Method | Path                  | Purpose                      |
| :----- | :-------------------- | :--------------------------- |
| `POST` | `/auth/token`         | Exchange attestation for JWT |
| `POST` | `/auth/token/refresh` | Rotate refresh token         |

**Usernames** — Register on the People Chain, check availability, search by prefix. A free registration queue exists for users without on-chain funds.

| Method | Path                   | Purpose            |
| :----- | :--------------------- | :----------------- |
| `POST` | `/usernames`           | Register on-chain  |
| `POST` | `/usernames/available` | Check availability |
| `GET`  | `/usernames/search`    | Search by prefix   |
| `GET`  | `/usernames/:username` | Get a username     |
| `GET`  | `/usernames`           | List all           |
| `POST` | `/registration/queue`  | Join free queue    |
| `GET`  | `/registration/queue`  | Queue status       |

**Push** — Register APNs, FCM, or Web Push tokens. Create subscriptions with rules that filter on-chain statements by topic and sender. When a statement is published on-chain, matched subscribers get a push delivery.

| Method   | Path                       | Purpose                  |
| :------- | :------------------------- | :----------------------- |
| `POST`   | `/subscriptions`           | Create subscription      |
| `GET`    | `/subscriptions`           | List subscriptions       |
| `DELETE` | `/subscriptions`           | Delete subscription      |
| `POST`   | `/subscriptions/rules`     | Add rules                |
| `PUT`    | `/subscriptions/rules`     | Replace rules            |
| `DELETE` | `/subscriptions/rules`     | Delete rules             |
| `POST`   | `/subscriptions/broadcast` | Broadcast to subscribers |
| `POST`   | `/notify`                  | Send push notification   |

**Tickets** — Request DIM credentials (Game or ProofOfInk). Claim invitation tickets signed on-chain.

| Method | Path                       | Purpose            |
| :----- | :------------------------- | :----------------- |
| `POST` | `/dim-ticket`              | Request DIM ticket |
| `GET`  | `/dim-ticket/:who`         | Ticket status      |
| `POST` | `/invitation-ticket/claim` | Claim invite       |

**Other**

| Method | Path                            | Purpose                     |
| :----- | :------------------------------ | :-------------------------- |
| `GET`  | `/attester`                     | Attester public key         |
| `POST` | `/turn/issue`                   | TURN credentials for WebRTC |
| `GET`  | `/schemas/statement`            | Statement JSON Schema       |
| `GET`  | `/schemas/push-payload/ios`     | iOS push payload schema     |
| `GET`  | `/schemas/push-payload/android` | Android push payload schema |

The OpenAPI spec lives at `/api/swagger/json` and as an interactive [Scalar](https://scalar.com) reference:

```bash
pnpm --filter @polkadot-app/api-docs dev
```

## Architecture

The service is built on **Effect-TS** and **Hono**. Domain logic lives in pure functions — decisions return `Either<Decision, Error>`, never throw, never touch I/O. Database queries, chain RPC, and push gateways wrap those decisions in thin executors.

It runs multi-instance: any pod can serve any HTTP request. Background work uses PostgreSQL advisory locks to elect a single leader pod. No shared in-memory state — Postgres is the only coordination point.

Six daemons run alongside the HTTP server: username indexer, DIM ticket processor, invitation ticket pool manager, registration queue manager, block finalization monitor, and on-chain statement subscriber (which converts new statements into push deliveries).

## Development

```bash
pnpm test                              # unit + integration
pnpm test:e2e:local                    # full Docker e2e stack
pnpm lint                              # oxlint
pnpm typecheck                         # TypeScript
pnpm check:ci                          # lint + typecheck + migration sync
pnpm --filter identity-backend-container db:migrate   # apply migrations
pnpm --filter @identity-backend/db db:generate        # generate migration
```

To run against a local chain, point an environment to `ws://localhost:8000`. The E2E suite uses [Chopsticks](https://github.com/AcalaNetwork/chopsticks) to fork the People Chain locally — see `apps/e2e-people-startup-container/`.

Docker:

```bash
docker build --target app-identity -t identity-backend .
docker compose -f docker/test/e2e/docker-compose.yml up
```

## Tagged builds

```bash
git fetch --tags
git checkout v1.9.0
pnpm install && pnpm build && pnpm check:ci
```

## Security

You are deploying a reference, not a production-hardened build. Review the code and dependencies yourself. Secure your deployment environment. Track tagged releases for fixes — older revisions are not backported.

> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

Report vulnerabilities via [Parity's security policy](https://github.com/paritytech/.github/blob/main/SECURITY.md). Do not open public issues. Bug bounty: [parity.io/bug-bounty](https://parity.io/bug-bounty).

## License

GPL-3.0 — see [LICENSE](../../LICENSE).
