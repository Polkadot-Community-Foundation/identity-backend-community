# Architecture Overview

> **What this file is:** a descriptive map of the Identity Backend — its shape, components, data, and integrations — for rapid comprehension.
>
> **What this file is NOT:** the rulebook. Every MUST / NEVER lives in [`AGENTS.md`](./AGENTS.md).

---

## The Single-Leader Split

The defining architectural decision is that **exactly one process at a time submits transactions to the Polkadot People Chain**. All other processes serve HTTP only.

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Deployment (N running processes)                    │
│                                                                        │
│  ┌─────────────────────┐          ┌─────────────────────────────┐    │
│  │ Leader (1)          │          │ Followers (N-1)             │    │
│  │ ─────────────────── │          │ ─────────────────────────── │    │
│  │ holds PostgreSQL    │          │ try advisory lock → false   │    │
│  │ session-scoped lock │          │ (lock held elsewhere)       │    │
│  │                     │          │                             │    │
│  │ runs daemon-leader  │          │ serve HTTP requests only    │    │
│  │ ├─ ChainMetrics     │          │ ├─ /api/v1/*               │    │
│  │ ├─ DimTicket        │          │ ├─ /webhooks               │    │
│  │ ├─ Individuality    │          │ ├─ /admin                  │    │
│  │ ├─ Invitation       │          │ └─ /healthcheck            │    │
│  │ ├─ Notifications    │          │                             │    │
│  │ ├─ LiteUsernameReg  │          │ enqueue to DB at most       │    │
│  │ └─ RegistrationQueue│          │ (never call chain directly) │    │
│  │                     │          │                             │    │
│  │ submits chain txns  │          │ submit ZERO chain txns      │    │
│  │ (nonce-protected)   │          │                             │    │
│  └─────────────────────┘          └─────────────────────────────┘    │
│                                                                        │
│  Lock:   pg_try_advisory_lock(hashtext('identity-backend:daemon-leader'))
│  Pool:   dedicated 2-connection pool with TCP keepalives              │
│  Reaper: queries pg_locks every 60s to detect dead sessions           │
│  Protocol: documented in src/leader-election/                         │
└────────────────────────────────────────────────────────────────────────┘
```

**Why this matters:** The People Chain has no native nonce management for concurrent same-signer submission. Two processes submitting with the same account would race on the nonce. The advisory lock makes concurrent submission **structurally impossible** — followers never run the supervision tree that hosts chain-submitting code paths.

**Chain-submitting code lives in these supervisors only:**

```
daemon-leader (holds the required lock)
├── ChainMetricsSupervisor
├── DimTicketSupervisor
├── IndividualityIndexerSupervisor
├── InvitationTicketSupervisor
├── NotificationsProcessorSupervisor
├── LiteUsernameRegistrationSupervisor
└── RegistrationQueueSupervisor
```

All children use `lock: { mode: 'none' }` — only `daemon-leader` acquires the lock.

---

## Domain Model

### DMMF pipeline

Every feature follows read (impure) → decode to branded domain types → decide in a pure `*.workflow` returning `Either<Decision, Error>` → shape outputs → write (impure).

- Decisions stay pure. I/O stays a thin shell. Dependencies point inward.
- Decode foreign shapes at the boundary; never cast.
- Target suffixes: `*.schema`, `*.workflow`, `*.acl`, `*.store`, `*.executor`. Legacy `.core.ts` / `.shell.ts` / `core/`+`shell/` folders are mid-migration.

### Edge

**Hono + single global `app.onError` + `ProblemDetail`** is the sanctioned edge. DMMF governs the domain core _behind_ the route. A route decodes the request, calls a workflow/executor, and returns. The decision lives in a pure `*.workflow.ts`.

---

## 1. Request Flow

```
┌─────────────┐     HTTP     ┌─────────────────┐
│ Polkadot App │◄───────────►│ Identity Backend │
│(iOS/Android) │             │  (N processes)   │
└─────────────┘             └─────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
      ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
      │  PostgreSQL  │    │Polkadot People│   │ Push Providers│
      │(shared state)│    │ Chain (WS)    │   │ (APNs/FCM)   │
      └──────────────┘    └──────────────┘    └──────────────┘
```

**HTTP path:**

1. Hono router → Middleware (auth, validation)
2. Route handler → Decodes request → Calls use case/workflow
3. Use case → Pure business logic → Returns `Either<Decision, Error>`
4. Effect Layer → Persists to PostgreSQL or calls external APIs
5. Response → Problem Details (4xx) or success payload

**Background path (leader only):**

1. `daemon-leader` acquires advisory lock → forks child supervisors
2. Workers poll/stream: check conditions → process batch → persist results
3. DefectReporter captures failures → Sentry / OpenTelemetry

---

## 2. Project Structure

```
apps/identity-backend/
├── src/
│   ├── app.ts                    # Hono application factory
│   ├── main.ts                   # Entry point (BunRuntime)
│   ├── runtime.ts                # Effect layer composition root
│   ├── config.ts                 # Environment configuration
│   ├── constants.ts              # Application constants
│   ├── runtime/                  # Logger, Rx, OTEL dispatch
│   ├── data/                     # Cross-cutting errors
│   ├── db/                       # DB connection and schema
│   ├── features/                 # Domain features (DMMF target)
│   │   ├── dim/
│   │   ├── individuality/
│   │   ├── subscriptions/
│   │   └── username-registration/
│   ├── infrastructure/
│   │   ├── adapters/             # Blockchain RPC
│   │   ├── observability/        # Sentry
│   │   └── telemetry/            # Metrics and tracing
│   ├── jwt/                      # Token issuance and rotation
│   ├── leader-election/          # Advisory lock (see above)
│   ├── lib/                      # Problem details, SS58, probes
│   ├── metrics/                  # Metrics definitions
│   ├── middleware/               # HTTP middleware
│   ├── routes/                   # HTTP route handlers
│   ├── schema/                   # Shared Zod schemas
│   ├── supervision/              # Background daemon supervisors
│   ├── tracing/                  # OTEL span context bridging
│   ├── types/                    # Shared TypeScript types
│   ├── username-registration/    # Queue + store (legacy, migrating)
│   ├── utils/                    # Helpers (IP, streams, token math)
│   └── webrtc/                   # TURN credential issuance
├── tests/                        # Integration and E2E tests
├── drizzle/                      # Database migrations
└── otel.ts                       # Test OTEL setup
```

> **Username registration spans three locations mid-migration:** domain logic in `features/username-registration/`, queue + store in top-level `username-registration/`, and daemon workers in `supervision/registration-queue/`. New work follows the DMMF suffix convention (see `AGENTS.md`).

---

## 3. Core Components

**Stack:** Bun · Hono + `@hono/zod-openapi` · Effect-TS (`Effect.gen`, `Layer`) · Vitest + `@effect/vitest` · OpenTelemetry OTLP + Sentry

### 3.1 HTTP Transport

Receives HTTP requests, validates input, authenticates devices, dispatches to domain logic.

| Route prefix                        | Purpose                         |
| ----------------------------------- | ------------------------------- |
| `/api/v1/*`                         | Public API (OpenAPI-documented) |
| `/webhooks`                         | External webhooks               |
| `/admin`                            | Admin operations (basic auth)   |
| `/healthcheck`, `/livez`, `/readyz` | Health probes                   |

### 3.2 Authentication

**Two-layer verification:**

- **Layer 1 — Platform Attestation:** Play Integrity (Android) or App Attest (iOS)
- **Layer 2 — Client Proof:** SR25519 signature over challenge + clientId

**Token management:** JWT access tokens (short-lived), opaque refresh tokens with single-use rotation.

`authPlugin` middleware owns Layer 1; route handlers own Layer 2.

### 3.3 Username Management

Reserves and registers usernames (`{base}.{digits}`) on the Polkadot People chain.

**Two-phase flow:**

1. Check availability against local index
2. Reserve in database (`RESERVED` status)
3. Background daemon submits registration to chain
4. Indexer syncs on-chain state back (`ASSIGNED` or `FAILED`)

**Key areas:** `features/username-registration/` (logic), `supervision/registration-queue/` (workers), `supervision/individuality-indexer/` (sync)

### 3.4 DIM Ticket System

Manages Dual Identity Mechanism credentials (Game or ProofOfInk) on the People chain.

**Lifecycle:** `PENDING` → `SUBMITTING` → `SUBMITTED` → `REGISTERED` | `FAILED`

**Key areas:** `features/dim/` (workflows), `supervision/invitation-ticket/` (daemon)

### 3.5 Push Notifications

Delivers push notifications based on on-chain statement subscriptions.

- **Subscription CRUD:** devices register tokens and define rules
- **Statement Processor:** subscribes to on-chain statements, matches against rules
- **Delivery Pipeline:** rate-limited, deduplicated delivery
- **Broadcast:** direct broadcast API

**Key areas:** `features/subscriptions/` (logic), `supervision/notifications-processor/` (daemon)

---

## 4. Data Stores

### PostgreSQL

Primary persistent store — the _only_ state shared between processes.

| Table                        | Purpose                               |
| ---------------------------- | ------------------------------------- |
| `individuality_usernames`    | Username registrations and status     |
| `challenges`                 | Single-use attestation challenges     |
| `apple_attestations`         | iOS attestation records               |
| `dim_tickets`                | DIM ticket lifecycle                  |
| `invitation_tickets`         | Pre-generated invitation keypairs     |
| `push_subscription`          | Device push tokens                    |
| `subscription_rule`          | Matching rules for push notifications |
| `push_record`                | Delivery records                      |
| `failed_push_record`         | Failed delivery records               |
| `rate_limit`                 | Per-sender rate limiting              |
| `android_device_identifiers` | Android device IDs                    |
| `refresh_tokens`             | JWT refresh tokens                    |
| `registration_queue_entries` | Username registration queue           |
| `leader_election`            | Advisory lock observability           |

---

## 5. External Integrations

| Integration                           | Purpose                                        | Technology                                         |
| ------------------------------------- | ---------------------------------------------- | -------------------------------------------------- |
| Polkadot People Chain                 | On-chain username registration and DIM tickets | WebSocket RPC via `@polkadot-api/substrate-client` |
| Asset Hub                             | Secondary chain interactions                   | WebSocket RPC                                      |
| Apple App Attest / DeviceCheck / APNs | iOS attestation and push                       | Apple SDKs                                         |
| Google Play Integrity / FCM           | Android attestation and push                   | Google SDKs                                        |
| Web Push Protocol                     | Browser push notifications                     | VAPID keypair                                      |

---

## 6. Deployment

**Architecture:** multi-instance, shared-nothing.

- Multiple processes serve HTTP traffic concurrently.
- A single `daemon-leader` holds the advisory lock for background work.
- The only shared state is PostgreSQL.
- In-memory state is process-local and ephemeral.

**Health probes:** `/healthcheck` (full, includes DB), `/livez` (liveness), `/readyz` (readiness, includes DB).

---

## 7. Security

- **Authentication:** platform attestation, SR25519 client proof, JWT with refresh rotation
- **Authorization:** route-level JWT verification, device-specific token binding
- **Data protection:** `Redacted<string>` for secrets, TLS for all external communication

---

## 8. Development Environment

```bash
corepack enable
corepack pnpm i
pnpm build
pnpm --filter identity-backend-container dev
```

**Test layers:** unit/property (Vitest + `@effect/vitest`), integration (boundary doubles), E2E (separate app package).

**Definition of done:** see `AGENTS.md`.

---

## 9. Glossary

| Term               | Definition                                      |
| ------------------ | ----------------------------------------------- |
| Username           | Personhood proof formatted as `{base}.{digits}` |
| Attestation        | Cryptographic proof submitted to chain          |
| Registration state | `RESERVED` → `ASSIGNED` → `FAILED`              |
| Invitation ticket  | DIM ticket granting the right to register       |
| Indexer            | Daemon syncing on-chain state to local DB       |
| BFF                | Backend-for-Frontend                            |
| DIM                | Dual Identity Mechanism (Game or ProofOfInk)    |
| DMMF               | Domain Modelling Made Functional                |
| People Chain       | Polkadot parachain for identity                 |
| Asset Hub          | Polkadot parachain for assets                   |
| SR25519            | Schnorr signature scheme                        |
| APNs               | Apple Push Notification service                 |
| FCM                | Firebase Cloud Messaging                        |
| VAPID              | Voluntary Application Server Identification     |
| OTEL               | OpenTelemetry                                   |
