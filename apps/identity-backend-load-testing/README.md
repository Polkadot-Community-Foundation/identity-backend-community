# Load Testing

k6 load-testing suite for the identity backend HTTP endpoints. Every request is
distributed-traceable, every search response is checked for correctness, and the
real proof-of-compute gate can be exercised end-to-end.

## What makes a request here different from a black-box `http.get`

| Capability                 | How                                                                                                                                                                                                                                                                                                                                                     |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Distributed tracing**    | Each request carries a sampled W3C `traceparent` with a cryptographically-random trace id (`k6/crypto` `randomBytes`, never `Math.random`). The backend continues the trace, so any slow/errored synthetic request opens as a full server-side span tree.                                                                                               |
| **Run correlation**        | The `User-Agent` is `k6-loadtest/<run_id> (scenario:<name>)`. Filter the trace backend by `http.user_agent` to isolate one run or exclude synthetic traffic from prod SLOs.                                                                                                                                                                             |
| **Server-time isolation**  | `server_processing_time` (from `timings.waiting`) and `network_overhead_time` are recorded as custom trends, tagged per scenario+endpoint — the client-perceived total is separated from real server latency.                                                                                                                                           |
| **Correctness under load** | Search responses are validated, not just status-checked: every returned username matches the queried prefix, `limit` is honored, the result shape is well-formed, and a second page does not overlap the first. Failures increment `correctness_failures`, which is a hard threshold.                                                                   |
| **Real auth path**         | With `POC=on`, the search flow requests a puzzle from `POST /api/v1/poc/issue`, solves it (SHA-256 brute force, byte-compatible with the server), and presents the `Proof-Of-Compute` header — exercising the gate unauthenticated production clients actually hit. A frozen-vector self-test aborts the run if the solver ever drifts from the server. |

## Scenarios

| Script              | Type              | Endpoint                         | Shape                                                                 |
| :------------------ | :---------------- | :------------------------------- | :-------------------------------------------------------------------- |
| `smoke-search`      | smoke             | `GET /api/v1/usernames/search`   | 5 VUs constant, 30s — sanity + correctness                            |
| `search`            | average load      | `GET /api/v1/usernames/search`   | ramping arrival rate 5→20 req/s, short/medium/full buckets, paginates |
| `stress-search`     | stress/breakpoint | `GET /api/v1/usernames/search`   | open-model ramp to `PEAK_RPS` (2000), aborts on >10% error rate       |
| `spike-search`      | spike             | `GET /api/v1/usernames/search`   | sudden jump to `SPIKE_RPS` (1500), holds, recovers                    |
| `concurrent-search` | concurrency       | `GET /api/v1/usernames/search`   | closed-model ramping VUs to `VUS` (2000) with think time              |
| `healthcheck`       | load              | `GET /healthcheck`               | 50 req/s constant, 60s — asserts DB-reachable `OK`                    |
| `auth-challenges`   | load              | `POST /api/v1/auth/challenges`   | 10 req/s constant, 30s                                                |
| `subscriptions`     | load              | `POST/GET /api/v1/subscriptions` | JWT-authenticated create + list, 2→10 req/s                           |

Search scenarios use the **open model** (arrival-rate executors) so the request
rate holds steady regardless of how slow the system gets — the way to find a
breaking point. `concurrent-search` uses the **closed model** (VUs + think time)
to model a fixed population of users.

## Gating

Thresholds — not checks — decide pass/fail (k6 checks never fail the run on their
own). Smoke and average-load set `checks: ['rate>0.99']`; the high-load scenarios
(`stress`/`spike`/`concurrent`) relax to `rate>0.95`. All search scenarios carry
`correctness_failures: ['count<1']`, plus per-endpoint `http_req_failed` and
`server_processing_time` SLOs. `correctness_failures` counts only semantically-wrong
`200` responses (a body that fails a contract check) — transport failures live in
`http_req_failed`, so the gate stays meaningful even where errors are tolerated.
`stress-search` sets `abortOnFail` with a 30s `delayAbortEval` so it stops as soon
as the system breaks past 10% errors.

## Running

```bash
pnpm --filter @identity-backend/load-testing build     # compile TypeScript → dist/*.mjs

pnpm test:load:smoke                                    # quick sanity (5 VUs, 30s)
pnpm test:load:search                                   # average-load search
pnpm test:load:stress                                   # ramp to breaking point
pnpm test:load:spike                                    # sudden traffic spike
pnpm test:load:concurrent                               # concurrent users
pnpm test:load:health                                   # health check at 50 rps
pnpm test:load:subscriptions                            # subscription create/list
pnpm test:load:auth-challenges                          # auth challenge issuance
```

Local end-to-end (Docker compose + seed + run): `bash scripts/load-test-local.sh <scenario>`
from the repo root — spins up the stack, seeds usernames, then runs the scenario.

## Daily regression watch (CI)

`.github/workflows/k6-load-test.yml` runs on a schedule (`cron: 0 10 * * *` —
05:00 EST / 06:00 EDT, finishing before 09:00 Eastern). The scheduled run seeds
**1,000,000** zipf-distributed usernames, runs the search suite (including the
`sparse_prefix` bucket that exercises the username-availability cliff), then:

1. **Captures the query plan** — `explain-search.ts` runs `EXPLAIN (ANALYZE, BUFFERS)`
   on the real search query for dense and sparse prefixes and flags any full scan.
2. **Builds a machine-readable report** — `analyze-perf-run.ts` compares the run
   against the committed baseline + the plan, emits `perf-summary.json`, and sets
   a regression verdict + dedup signature.
3. **Files a GitHub issue on regression** (scheduled runs only) via the GitHub API:
   one open issue per signature (deduped, commented on repeat days), labelled
   `perf-regression`, body carrying the metric diff, repro command, trace filter,
   and the EXPLAIN plan table. It **auto-closes** when a later run recovers.

`perf-summary.json` and the EXPLAIN plan are uploaded as the `perf-report` artifact.
PR runs produce the same artifacts but never open issues.

## Configuration

| Variable          | Default                 | Purpose                                                                           |
| :---------------- | :---------------------- | :-------------------------------------------------------------------------------- |
| `BASE_URL`        | `http://localhost:8080` | Backend base URL                                                                  |
| `LOADTEST_RUN_ID` | `local-dev`             | Stamped onto every request's User-Agent for trace correlation                     |
| `POC`             | `off`                   | `on` exercises the proof-of-compute gate (needs `POC_ENABLED=true` on the target) |
| `JWT_SECRET`      | —                       | Secret for generating test JWTs (subscriptions)                                   |
| `SEARCH_LIMIT`    | `20`                    | Page size for search scenarios                                                    |
| `PEAK_RPS`        | `2000`                  | Peak RPS for stress test                                                          |
| `SPIKE_RPS`       | `1500`                  | Peak RPS for spike test                                                           |
| `VUS`             | `2000`                  | Max concurrent users for concurrent test                                          |
| `SOAK_DURATION`   | `2m`                    | Soak duration for stress / concurrent                                             |
| `SMOKE`           | —                       | `1` runs `search` / `subscriptions` in a reduced smoke shape                      |
| `BUCKET`          | all                     | Restrict `search` to one prefix bucket (`short` / `medium` / `full` / `sparse`)   |
| `BASELINE_RPS`    | `50`                    | Pre-spike steady arrival rate for `spike-search`                                  |
| `THINK_TIME`      | `1`                     | Per-iteration think time (seconds) for `concurrent-search`                        |

### Fixture seeding & query-plan tooling (`ts-setup/`, Node + `tsx`)

| Variable                 | Default                                                         | Purpose                                                                      |
| :----------------------- | :-------------------------------------------------------------- | :--------------------------------------------------------------------------- |
| `DATABASE_URL`           | `postgres://postgres:password@localhost:15432/identity_backend` | Postgres target for seeding and `EXPLAIN`                                    |
| `FIXTURE_PROFILE`        | `zipf`                                                          | Username distribution to seed (`uniform` / `corpus` / `zipf`)                |
| `PREFIX_MANIFEST`        | `apps/identity-backend-load-testing/prefixes.json`              | Path the seed writes and the k6 scripts read so searches match seeded data   |
| `SEED_ALLOW_PRODUCTION`  | —                                                               | `1` overrides the production-`DATABASE_URL` guard (do not set in normal use) |
| `EXPLAIN_OUT`            | `explain-search.json`                                           | JSON output path for the query-plan analysis                                 |
| `EXPLAIN_TEXT_OUT`       | `explain-search.txt`                                            | Human-readable `EXPLAIN` text output path                                    |
| `EXPLAIN_FULL_SCAN_ROWS` | `100000`                                                        | Rows-removed-by-filter threshold that marks a plan a full scan               |
| `EXPLAIN_SLOW_MS`        | `1000`                                                          | Execution-time threshold (ms) that marks a plan a full scan                  |
