# Architecture Overview

> **What this file is:** a descriptive map of the Identity Backend — its shape, components, data, and integrations — for rapid comprehension. Read it once to orient before working in an unfamiliar area.
>
> **What this file is NOT:** the rulebook. Every MUST / NEVER, the error-handling and ProblemDetail contracts, the deployment-safety invariant, and the definition of done live in [`AGENTS.md`](./AGENTS.md) — which is loaded automatically every session. This file states _how the system is_, never _what you must do_. If you find a rule here, it is in the wrong file.

## 1. Project Structure

```
apps/identity-backend/
├── src/
│   ├── app.ts                    # Hono application factory and route mounting
│   ├── main.ts                   # Entry point: composes layers, starts the server (BunRuntime)
│   ├── runtime.ts                # Effect layer composition root (services, infra, telemetry)
│   ├── config.ts                 # Environment configuration (all env vars in one place)
│   ├── constants.ts              # Application-wide constants
│   ├── runtime/                  # Runtime support: logger, Rx, OpenTelemetry dispatch (otel.ts → otel/)
│   ├── data/                     # Shared data module (cross-cutting errors, re-exports)
│   ├── db/                       # Database connection and schema re-exports
│   ├── features/                 # Domain features (business logic)
│   │   ├── dim/                  # DIM ticket management
│   │   ├── individuality/        # Username availability services
│   │   ├── subscriptions/        # Push notification subscriptions and delivery
│   │   └── username-registration/# Username registration logic
│   ├── infrastructure/           # Infrastructure adapters and services
│   │   ├── adapters/             # Blockchain RPC and other external adapters
│   │   ├── observability/        # Error reporting (Sentry) and telemetry
│   │   └── telemetry/            # Metrics and tracing daemons
│   ├── jwt/                      # JWT token issuance and rotation
│   ├── leader-election/          # PostgreSQL advisory lock leader election
│   ├── lib/                      # Shared utilities (problem details, SS58, kube probe paths)
│   ├── metrics/                  # Application metrics definitions
│   ├── middleware/               # HTTP middleware (auth plugin, HTTP metrics)
│   ├── routes/                   # HTTP route handlers (v1/, shared/, admin, debug-*)
│   ├── schema/                   # Shared Zod schemas
│   ├── supervision/              # Background daemon supervisors (see §3.6)
│   ├── tracing/                  # OpenTelemetry span context bridging
│   ├── types/                    # Shared TypeScript types
│   ├── username-registration/    # Registration queue + store (see note below)
│   ├── utils/                    # Small helpers (IP parsing, streams, token math)
│   └── webrtc/                   # WebRTC TURN credential issuance
├── tests/                        # Integration and E2E tests
├── drizzle/                      # Database migrations
└── otel.ts                       # Test-only OpenTelemetry setup (referenced by vitest.config.ts)
```

> **Username registration spans three locations mid-migration:** the domain logic in `features/username-registration/`, the queue + store in the top-level `username-registration/`, and the daemon workers in `supervision/registration-queue/`. New work follows the target DMMF structure (see `AGENTS.md` → _Structure: target vs legacy_); do not infer the convention from whichever of these you land in.

## 2. High-Level System Diagram

```
┌─────────────────┐     HTTP      ┌──────────────────────┐
│  Polkadot App   │◄─────────────►│  Identity Backend    │
│  (iOS/Android)  │               │  (Kubernetes pods)   │
└─────────────────┘               └──────────────────────┘
                                         │
           ┌─────────────────────────────┼─────────────────────────────┐
           │                             │                             │
           ▼                             ▼                             ▼
┌──────────────────┐          ┌──────────────────┐          ┌──────────────────┐
│   PostgreSQL     │          │  Polkadot People │          │  Push Providers  │
│   (shared state) │          │  Chain (WebSocket)│         │  (APNs/FCM/Web)  │
└──────────────────┘          └──────────────────┘          └──────────────────┘
```

### Request Flow

1. **HTTP Request** → Hono router → Middleware (auth, validation)
2. **Route Handler** → Decodes request → Calls use case/workflow
3. **Use Case** → Pure business logic → Returns decision or typed error
4. **Effect Layer** → Persists to PostgreSQL or calls external APIs
5. **Response** → Problem Details (4xx) or success payload

### Background Daemon Flow

1. **daemon-leader** acquires the PostgreSQL advisory lock
2. **Supervisors** fork child workers (one-for-one restart policy)
3. **Workers** poll/stream: check conditions → process batch → persist results
4. **DefectReporter** captures failures → Sentry / OpenTelemetry

## 3. Core Components

**Technology stack:** Bun runtime (Node.js 24+ in dev) · Hono + `@hono/zod-openapi` for HTTP · Effect-TS (`Effect.gen`, `Layer`) for async orchestration and dependency injection · Vitest with `@effect/vitest` for tests · OpenTelemetry (OTLP) + Sentry for telemetry.

### 3.1. HTTP Transport Layer

**Responsibility:** Receives HTTP requests, validates input, authenticates devices, dispatches to domain logic, returns responses.

**Key Technologies:** Hono, `@hono/zod-openapi`, Zod.

**Route Groups:**

- `/api/v1/*` — Public API (OpenAPI-documented)
- `/webhooks` — External webhooks
- `/admin` — Admin operations (basic auth)
- `/healthcheck`, `/livez`, `/readyz` — Health probes (defined in `src/app.ts`; paths in `src/lib/kube.ts`)

### 3.2. Authentication & Authorization

**Responsibility:** Verifies device authenticity and client identity.

**Two-Layer Verification:**

- **Layer 1 — Platform Attestation:** proves the device is genuine.
  - iOS: Apple App Attest (challenge-response)
  - Android: Google Play Integrity OR Android Keystore key attestation
- **Layer 2 — Client Proof:** SR25519 signature proving key ownership.

**Token Management:**

- JWT access tokens (short-lived)
- Opaque refresh tokens with single-use rotation

The unified `authPlugin` middleware (`@identity-backend/hono-auth`) owns Layer 1; route handlers own Layer 2.

### 3.3. Username Management

**Responsibility:** Reserves and registers human-readable usernames (`{base}.{digits}`) on the Polkadot People chain.

**Flow (two-phase — the DB reserve precedes chain submission, which is asynchronous):**

1. Check availability against the local index
2. Reserve in database (`RESERVED` status)
3. Background daemon submits registration to chain
4. Indexer syncs on-chain state back (`ASSIGNED` or `FAILED`)

**Key Areas:**

- `src/features/username-registration/` — Registration logic
- `src/supervision/registration-queue/` — Queue workers
- `src/supervision/individuality-indexer/` — On-chain sync

### 3.4. DIM Ticket System

**Responsibility:** Manages Dual Identity Mechanism credentials (Game or ProofOfInk) on the People chain.

**Lifecycle:** `PENDING` → `SUBMITTING` → `SUBMITTED` → `REGISTERED` | `FAILED`

**Components:**

- Invitation ticket pool (pre-generated keypairs)
- Ticket claiming (users claim an available ticket)
- Background daemon processes pending tickets and submits to chain

**Key Areas:**

- `src/features/dim/` — Ticket workflows and blockchain service
- `src/supervision/invitation-ticket/` — Daemon supervision

### 3.5. Push Notification System

**Responsibility:** Delivers push notifications to devices based on on-chain statement subscriptions.

**Components:**

- **Subscription CRUD:** devices register tokens (APNs/FCM/Web) and define rules (sender + topic)
- **Statement Processor:** subscribes to on-chain statements, matches against rules
- **Delivery Pipeline:** rate-limited, deduplicated delivery to matched devices
- **Broadcast:** direct broadcast API for immediate push delivery

**Key Areas:**

- `src/features/subscriptions/` — Subscription and delivery logic
- `src/supervision/notifications-processor/` — Background processing

### 3.6. Background Daemons

**Responsibility:** Performs asynchronous, singleton work under leader election.

**Supervision Tree:**

```
daemon-leader (holds the required advisory lock)
├── ChainMetricsSupervisor
├── IndividualityIndexerSupervisor
├── InvitationTicketSupervisor
├── NotificationsProcessorSupervisor
├── LiteUsernameRegistrationSupervisor
└── RegistrationQueueSupervisor
```

**Leader Election:** A single PostgreSQL advisory lock means only one pod runs the daemons at a time. The lock protocol (reaper, pool sizing, keepalives) is documented in `src/leader-election/AGENTS.md`.

## 4. Data Stores

### 4.1. PostgreSQL

**Purpose:** Primary persistent store for all application state — and the _only_ state shared between pods.

**Key Tables:**

- `individuality_usernames` — Username registrations and status
- `challenges` — Single-use attestation challenges
- `apple_attestations` — iOS attestation records
- `dim_tickets` — DIM ticket lifecycle
- `invitation_tickets` — Pre-generated invitation keypairs
- `push_subscription` — Device push tokens
- `subscription_rule` — Matching rules for push notifications
- `push_record` — Delivery records
- `failed_push_record` — Failed delivery records
- `rate_limit` — Per-sender rate limiting state
- `android_device_identifiers` — Android device IDs
- `refresh_tokens` — JWT refresh tokens
- `registration_queue_entries` — Username registration queue
- `leader_election` — Advisory lock state

## 5. External Integrations

### 5.1. Polkadot People Chain

**Purpose:** On-chain username registration and DIM ticket submission.

**Integration:** WebSocket RPC via `@polkadot-api/substrate-client`.

### 5.2. Asset Hub

**Purpose:** Secondary chain interactions (balance checks, etc.).

**Integration:** WebSocket RPC.

### 5.3. Apple Services

- App Attest (device attestation)
- DeviceCheck (iOS device verification)
- APNs (push notifications)

### 5.4. Google Services

- Play Integrity (device attestation)
- FCM (push notifications)

### 5.5. Web Push

**Purpose:** Browser-based push notifications.

**Integration:** VAPID keypair, Web Push Protocol.

## 6. Deployment & Infrastructure

**Platform:** Kubernetes. **Architecture:** multi-instance, shared-nothing.

- Multiple pods serve HTTP traffic concurrently.
- A single `daemon-leader` holds the advisory lock for background work.
- The only shared state is the PostgreSQL database.
- In-memory state is pod-local and ephemeral.

**Health Probes:** `/healthcheck` (full, includes DB connectivity), `/livez` (liveness), `/readyz` (readiness, includes DB connectivity).

> The _safety rule_ derived from this model — "would this break if I scaled to 3 pods right now?" — and the prohibition on shared caches and pod-local-as-shared state are enforced in `AGENTS.md`. This section only describes the shape.

## 7. Security Considerations

**Authentication:** platform attestation (Apple App Attest / Google Play Integrity), SR25519 client proof signatures, JWT access tokens with refresh-token rotation.

**Authorization:** route-level JWT verification, device-specific token binding.

**Data Protection:** sensitive values are wrapped in `Redacted<string>` so secrets stay out of logs; PostgreSQL holds persistent state; all external communication is over TLS.

## 8. Development & Testing Environment

**Local Setup:**

```bash
corepack enable
corepack pnpm i
pnpm build
pnpm --filter identity-backend-container dev
```

**Test Layers:** unit/property tests (Vitest + `@effect/vitest`), integration tests (real in-context collaboration with boundary doubles), and E2E tests (a separate app package).

**Verification & definition of done are owned by [`AGENTS.md`](./AGENTS.md).** Run the commands it lists from the workspace root; that file is the single source of truth for what "done" means.

## 9. Roadmap / Known Tech Debt

- Username registration is mid-migration from legacy `.core.ts` / `.shell.ts` and split locations (§1) toward the DMMF suffix convention.
- Username indexer optimization for large-scale deployments.
- Additional push notification providers.

## 10. Glossary

| Term               | Definition                                                    |
| ------------------ | ------------------------------------------------------------- |
| Username           | Personhood proof formatted as `{base}.{digits}`               |
| Attestation        | Cryptographic proof submitted to chain, verified via Ring-VRF |
| Registration state | `RESERVED` (pre-chain) → `ASSIGNED` (on-chain) → `FAILED`     |
| Invitation ticket  | DIM ticket granting the right to register                     |
| Indexer            | Daemon syncing on-chain state to the local database           |
| BFF                | Backend-for-Frontend                                          |
| DIM                | Dual Identity Mechanism (Game or ProofOfInk credentials)      |
| DMMF               | Domain Modelling Made Functional (Scott Wlaschin — DDD + FP)  |
| People Chain       | Polkadot parachain for identity and usernames                 |
| Asset Hub          | Polkadot parachain for assets and balances                    |
| SR25519            | Schnorr signature scheme used in Polkadot                     |
| APNs               | Apple Push Notification service                               |
| FCM                | Firebase Cloud Messaging                                      |
| VAPID              | Voluntary Application Server Identification for Web Push      |
| OTEL               | OpenTelemetry                                                 |
| CRL                | Certificate Revocation List                                   |
