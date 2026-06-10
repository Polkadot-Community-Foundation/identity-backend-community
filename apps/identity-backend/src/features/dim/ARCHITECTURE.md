# Invitation Ticket — Architecture

Feature-specific design reference. For general project patterns (FCIS, error typing, OTel conventions) see the root `AGENTS.md`. For operational rules see this directory's `AGENTS.md`. For the behavioral contract see `__tests__/specs/`.

---

## §1. Domain Model

### Entities

A **Ticket** is an sr25519 keypair registered on-chain as an invitation credential. The backend controls the keypair and signs user addresses with it. Tickets are **disposable** — failed on-chain registrations are deleted and regenerated rather than retried.

A **Pool** groups tickets keyed by `(dim, network)`. Pools are independent: claims from one pool never affect another.

A **Claim** is a single atomic operation: validate the user's SS58, find the oldest available ticket, sign the user's address with the ticket's private key, and mark the ticket claimed — all in one DB transaction.

### State machine

```
(new keypair)
  └── daemon: generate + set_invite_ticket + finalize ──┐
                                                        ▼
                                                   ┌──────────┐
                                                   │available │
                                                   └────┬─────┘
                                                        │ atomic UPDATE
                                                        ▼
                                                   ┌──────────┐
                                                   │ claimed  │
                                                   └──────────┘

(new keypair) ── on-chain registration fails ──> (deleted, regenerate)
```

Two end states only. No `failed`, no `retrying`, no `submitting`. The DB column stores `unclaimed_off_chain | unclaimed_on_chain | claimed` (to distinguish raw vs ready vs claimed); only `unclaimed_on_chain` is claimable.

---

## §2. Components

```
ClaimInvitationTicketShell      TicketPoolDaemon (loop)
         │                              │
         ▼                              ▼
decidePoolStatus(count, target) ◄── only pure decision in this feature
         │                              │
         ▼                              ▼
PostgreSQL (Drizzle direct)        Substrate RPC
                                   Sr25519 WASM
```

The shell is agnostic to its caller — it accepts a `ClaimCommand`. Inbound adapters (HTTP, daemon, future RPC) are this feature's concern only insofar as they pass `ClaimCommand` in and propagate the typed result back; the shell does not know which adapter invoked it.

**Shell calls Drizzle directly.** No `Repository`/`save()`/`findById()` indirection — schema transforms at the boundary do the row↔domain conversion. The DB is an implementation detail, not a domain concept.

**Pure core is thin.** The only pure business decision is:

```
decidePoolStatus(count, target) -> NeedMore(NonNegativeInt) | PoolOK
```

Everything else (`Ticket`, `ClaimCommand`, `ClaimResult`) is a row or DTO with a schema transform.

---

## §3. Workflows

### Claim Ticket (HTTP request)

```
INPUT  → schema decode at HTTP boundary
       → find oldest ready ticket   [None → PoolExhaustedError]
       → sr25519.sign(privateKey, who)
PURE   → assemble ClaimResult { ticket, signature, remaining }
OUTPUT → atomic UPDATE WHERE state = 'unclaimed_on_chain'
            0 rows → TicketRaceError
            1 row  → success
```

The atomic UPDATE is the concurrency guard. Two requests may read the same ticket; only one UPDATE wins. The loser gets `TicketRaceError`.

### Maintain Pool (daemon loop)

```
INPUT  → count available tickets
PURE   → decidePoolStatus(count, target)
            PoolOK     → sleep(INTERVAL); repeat
            NeedMore(n)→ continue
OUTPUT → for i in 1..n:
           generate sr25519 keypair
           submit set_invite_ticket
           wait for finalization
              success → INSERT as available
              failure → discard keypair (no state persisted)
         sleep(INTERVAL)
```

Generation and on-chain registration are a single synchronous unit per ticket. **Failed registrations leave no trace** — the keypair is discarded, the daemon generates a new one next iteration.

---

## §4. Shell Interfaces

### `ClaimInvitationTicketShell.execute(cmd: ClaimCommand)`

Returns `Result<ClaimResult, PoolExhaustedError | TicketRaceError>`.

Deps: `db: DrizzleORM`, `crypto: Sr25519Service`.

```
1. db.query.findOldestUnclaimed(dim, network)  → ticket | None
2. crypto.sign(ticket.privateKey, cmd.who)     → signature
3. db.query.atomicClaim(ticket.id, cmd.who)    → 0 | 1 rows
4. assemble { ticket, signature, remaining }
```

### `TicketPoolDaemon.execute(dim, network)`

Returns `void`. Loops forever.

Deps: `db: DrizzleORM`, `crypto: Sr25519Service`, `blockchain: SubstrateClient`.

```
1. count = db.query.countAvailable(dim, network)
2. switch decidePoolStatus(count, target):
     PoolOK → sleep(INTERVAL); goto 1
     NeedMore(n) → for i in 1..n:
                     keypair    = crypto.generateSr25519()
                     finalized  = blockchain.setInviteTicket(keypair.publicKey)
                     if finalized: db.query.insertTicket(keypair, 'available')
                     else: discard
3. sleep(INTERVAL); goto 1
```

---

## §5. Errors

### Domain (typed, expected)

| Error                | Trigger                                | HTTP |
| -------------------- | -------------------------------------- | ---- |
| `PoolExhaustedError` | No `unclaimed_on_chain` ticket in pool | 422  |
| `TicketRaceError`    | Atomic UPDATE affected zero rows       | 409  |

Parse errors are NOT domain errors — schema validation happens at the HTTP route boundary and returns RFC 9457 Problem Details with HTTP 400. The shell never sees parse failures.

### Infrastructure (defects)

| Defect                      | Claim handler      | Daemon                       |
| --------------------------- | ------------------ | ---------------------------- |
| `DatabaseConnectionError`   | Retry 3×, else 500 | Retry 3×, log, continue loop |
| `DatabaseTimeoutError`      | Retry 3×, else 500 | Retry 3×, log, continue loop |
| `BlockchainConnectionError` | N/A                | Discard ticket, regenerate   |
| `BlockchainTimeoutError`    | N/A                | Discard ticket, regenerate   |

**Why the asymmetry**: the claim handler has a user waiting (~1.7s budget); the daemon has none, so it discards-and-retries the unit of work rather than the operation.

### Panics (let surface)

| Source               | Action                         |
| -------------------- | ------------------------------ |
| sr25519 WASM failure | Alert ops; restart process     |
| DB corruption        | Alert ops; manual intervention |
| OOM                  | Process restart                |

---

## §6. Retry Budgets (this feature only)

| Operation            | Attempts | Base  | Factor | Jitter  | Total budget |
| -------------------- | -------- | ----- | ------ | ------- | ------------ |
| DB read              | 3        | 100ms | ×2     | 80–120% | ~840ms       |
| Atomic claim (write) | 3        | 200ms | ×2     | 80–120% | ~1.7s        |
| Blockchain extrinsic | 1        | —     | —      | —       | single-shot  |

Atomic claim is idempotent because of `WHERE state = 'unclaimed_on_chain'` — same input, same outcome. Without that guard, retry would double-claim.

Blockchain has no retry: a failed extrinsic discards the keypair (no state to replay against).

---

## §7. Observability — names

### Spans

```
HTTP POST /api/v1/invitation-tickets/claim    (root)
  └─ claim_invitation_ticket                   { dim, network }
       ├─ db.postgresql.select                 { operation, table }
       ├─ crypto.sign                          {}
       └─ db.postgresql.update                 { operation, table, rows_affected }

job.maintain_pool                              (daemon root) { dim, network }
  └─ blockchain.set_invite_ticket              { network }
       └─ blockchain.wait_finalization         { tx_hash }
```

### Span events

`pool_exhausted`, `ticket_race_lost`, `ticket_generated`, `ticket_claimed`.

### Metrics

| Metric                                                      | Type      | Dims                 |
| ----------------------------------------------------------- | --------- | -------------------- |
| `invitation_tickets.claimed_total`                          | Counter   | dim, network, status |
| `invitation_tickets.pool_size`                              | Gauge     | dim, network         |
| `invitation_tickets.generation_total`                       | Counter   | dim, network, status |
| `invitation_tickets.claim_latency`                          | Histogram | dim, network         |
| `invitation_tickets.set_invite_ticket.submission_latency`   | Histogram | dim, network         |
| `invitation_tickets.set_invite_ticket.finalization_latency` | Histogram | dim, network         |

### Telemetry redaction (this feature's secrets)

| Field        | Spans | Logs      | Metric labels |
| ------------ | ----- | --------- | ------------- |
| `privateKey` | NEVER | NEVER     | NEVER         |
| `signature`  | OK    | NEVER     | NEVER         |
| `who` (SS58) | OK    | hash only | NEVER         |

---

## §8. Invariants

**Data**

1. Only `unclaimed_on_chain` tickets are claimable.
2. Claim is atomic via `UPDATE ... WHERE state = 'unclaimed_on_chain'`.
3. `sr25519.verify(signature, utf8_bytes(who), ticket.publicKey)` MUST hold for every claimed row.
4. Pools are scoped by `(dim, network)`. Cross-pool leakage = bug.
5. FIFO: oldest `created_at` wins.
6. Private keys never leave the backend process.
7. Failed registrations are deleted, not preserved.

**Operational**

8. Daemon runs continuously; stoppage causes pool depletion.
9. Pool target is 50 tickets, batch size 10. Tune to claim rate.
10. No per-user quota yet. JWT-gated quota is future work.
11. Blockchain finalization takes minutes — daemon polls; HTTP path never blocks on it.

---

## §9. Comparison: DIM Tickets vs Invitation Tickets

| Aspect            | DIM Tickets                   | Invitation Tickets               |
| ----------------- | ----------------------------- | -------------------------------- |
| **Who creates**   | User submits their SS58       | Backend generates keypairs       |
| **Who pays gas**  | Backend (inviter)             | Backend (inviter)                |
| **On-chain flow** | `set_invite_ticket` (inviter) | `set_invite_ticket` (inviter)    |
| **Wait time**     | Minutes                       | Instant (backend response)       |
| **Auth**          | JWT required                  | Platform attestation required    |
| **Table**         | `dim_tickets`                 | `invitation_tickets`             |
| **Pool**          | User-initiated, one-at-a-time | Backend-managed, batch           |
| **Failure**       | Backend absorbs, user sees    | Backend absorbs, user never sees |

---

## §10. Glossary

| Term             | Definition                                         |
| ---------------- | -------------------------------------------------- |
| **DIM**          | Decentralized Identity Module — Game or ProofOfInk |
| **Ticket**       | sr25519 keypair registered on-chain                |
| **Pool**         | Pre-staged tickets for a `(dim, network)` pair     |
| **Claim**        | Atomic assign + sign operation                     |
| **Pre-staging**  | Generating tickets before demand                   |
| **Atomic claim** | UPDATE with WHERE prevents double-assign           |
| **sr25519**      | Polkadot's native Schnorr signature                |
| **SS58**         | Substrate address format                           |
| **Extrinsic**    | Blockchain transaction                             |
| **Finalization** | Block confirmation                                 |
