# @identity-backend/dim-ticket

Pure domain package for the DIM (Dual Identity Mechanism) ticket workflow. Zero I/O. Fully extractable. 100% Stryker mutation score.

---

## What is a DIM Ticket?

A DIM ticket is a request for a Game or ProofOfInk credential on the Polkadot People chain. The flow:

1. A user submits their SS58 address (`who`) via POST `/v1/dim-ticket`
2. The server creates a PENDING ticket with the server's inviter address
3. A background daemon picks up PENDING tickets and submits them on-chain
4. The ticket transitions to SUBMITTED → REGISTERED (or FAILED with retry)

This package contains the pure domain logic — state machines, validation, batch planning — with no database or blockchain dependencies.

---

## Installation

This is a private workspace package. Import from the single export:

```typescript
import {
  computeRetryDelay,
  PendingTicket,
  planBatchProcessing,
  validateInviterDistinct,
} from '@identity-backend/dim-ticket'
```

---

## Package Structure

```
src/
  types.ts                      Shared: branded addresses, DimTicketRecord schema
  dim-ticket.types.ts           API: ticket state machine, errors, BatchRegistrationResult
  dim-ticket.fn.ts              API: pure functions (validateInviterDistinct, state transitions)
  dim-ticket-daemon.types.ts    Daemon: batch processing events (NoTicketsFound, TicketsMarkedExhausted, ...)
  dim-ticket-daemon.fn.ts       Daemon: computeRetryDelay (only exported fn; helpers are workflow-private)
  dim-ticket-daemon.workflow.ts Daemon: planBatchProcessing
  mod.ts                        Barrel: re-exports all types and functions
  __tests__/
    dim-ticket.schema.test.ts                  Rule of Schemas roundtrips
    dim-ticket.fn.property.test.ts             Domain invariants PBT
    dim-ticket-daemon.fn.property.test.ts      computeRetryDelay PBT
    dim-ticket-daemon.workflow.property.test.ts planBatchProcessing PBT
```

---

## API Reference

**Shared value objects (from `types.ts`):**

| Export            | Type             | Description                                                |
| ----------------- | ---------------- | ---------------------------------------------------------- |
| `InviterAddress`  | `Schema.Brand`   | SS58 address of the server-side inviter authority          |
| `InviteeAddress`  | `Schema.Brand`   | SS58 address of the ticket holder                          |
| `DIMLiteral`      | `Schema.Literal` | `'Game' \| 'ProofOfInk'`                                   |
| `NetworkLiteral`  | `Schema.Literal` | `'westend2' \| 'paseo' \| 'polkadot'`                      |
| `DimTicketRecord` | `Schema.Struct`  | Bidirectional storage record (decode from DB, encode back) |

**Ticket state machine:**

| Export                  | Description                               |
| ----------------------- | ----------------------------------------- |
| `PendingTicket`         | Just created, awaiting daemon pickup      |
| `SubmittedTicket`       | Submitted on-chain, awaiting finalization |
| `RegisteredTicket`      | Successfully registered on-chain          |
| `PendingFailedTicket`   | Failed from PENDING state                 |
| `SubmittedFailedTicket` | Failed from SUBMITTED state               |
| `DimTicketStatus`       | Union of all 5 states                     |

**Pure functions:**

| Export                      | Signature                                                              | Description                                         |
| --------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------- |
| `validateInviterDistinct`   | `(ticket, inviter) → Either<void, DimTicketInviterMatchesTicketError>` | **Domain invariant**: inviter must not equal ticket |
| `submitDimTicket`           | `(pending, submittedAt) → SubmittedTicket`                             | State transition                                    |
| `dimTicketFromRecord`       | `(row, stateTimestamp) → DimTicketStatus`                              | Decode DB row to domain state                       |
| `resolveDimTicketTimestamp` | `(updatedAt, now) → Date`                                              | Resolve state timestamp                             |

**Daemon functions and types:**

| Export                       | Description                                                                                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- |
| `computeRetryDelay`          | `(baseMs, maxMs, maxExponent) → (attempt) → number` — parameterized exponential backoff              |
| `planBatchProcessing`        | `(tickets, now, maxRetries, initialRetryDelayMs) → Either<BatchProcessingCommand[], NoTicketsFound>` |
| `NoTicketsFound`             | No tickets to process                                                                                |
| `TicketsMarkedExhausted`     | Tickets that exceeded `maxRetries`                                                                   |
| `OrphanedTicketsRecovered`   | SUBMITTED tickets being reset to PENDING                                                             |
| `BatchPreparedForSubmission` | Batch ready for on-chain submission                                                                  |

---

## Testing

```bash
# Run all tests
pnpm --filter @identity-backend/dim-ticket test

# Mutation testing (must achieve 100%)
pnpm --filter @identity-backend/dim-ticket mutation

# Type checking
pnpm --filter @identity-backend/dim-ticket typecheck
```

### Test Philosophy

All tests use property-based testing (PBT) with fast-check. The package achieves **100% Stryker mutation score** — every code path is tested with mathematical invariants, not just example-based assertions.

Key invariants tested:

- `computeRetryDelay` is monotone non-decreasing and never exceeds `maxMs`
- `validateInviterDistinct(addr, addr)` always returns `Either.left` (named law, not just a test)
- `planBatchProcessing` produces events in causal order (exhausted → orphaned → batch)
- `DimTicketRecord` roundtrips: `decode(encode(a)) === a` and `encode(decode(raw)) === raw`

---

## Architecture Notes

**Why a separate package?** The pure domain logic (state machines, validation, batch planning) can be tested in isolation with no mocks, no database, no blockchain. Extracting it enforces the dependency boundary and enables Stryker mutation testing without expensive integration test overhead.

**Config is not domain.** Values like `maxRetries = 5` or `retryBaseMs = 1000` are deployment configuration, not domain logic. They belong in `RegisterDIMTicketsDaemonConfig` in the app's runtime. The package only defines the parameterized functions that accept these values.

---

## License

Private. Part of the identity-backend monorepo.
