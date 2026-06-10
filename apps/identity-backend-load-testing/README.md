# Load Testing

k6-based load testing suite for the identity backend HTTP endpoints.

## Scenarios

| Script              | Endpoint                         | Purpose                                                                 |
| :------------------ | :------------------------------- | :---------------------------------------------------------------------- |
| `smoke-search`      | `GET /api/v1/usernames/search`   | 5 VUs constant, 30s quick sanity                                        |
| `search`            | `GET /api/v1/usernames/search`   | Ramping 5→20 req/s, short/medium/full prefixes                          |
| `healthcheck`       | `GET /healthcheck`               | 50 req/s constant, 60s                                                  |
| `subscriptions`     | `POST/GET /api/v1/subscriptions` | JWT-authenticated, 2→10 req/s                                           |
| `auth-challenges`   | `POST /api/v1/auth/challenges`   | 10 req/s constant, 30s                                                  |
| `stress-search`     | `GET /api/v1/usernames/search`   | Ramp to configurable `PEAK_RPS` (default 2000), inflection-point finder |
| `concurrent-search` | `GET /api/v1/usernames/search`   | Ramp to configurable `VUS` (default 2000) concurrent users              |

## Running

```bash
pnpm --filter @identity-backend/load-testing build     # compile TypeScript

pnpm test:load:smoke                                    # quick sanity (5 VUs, 30s)
pnpm test:load:search                                   # username search
pnpm test:load:health                                   # health check at 50 rps
pnpm test:load:subscriptions                            # subscription create/list
pnpm test:load:auth-challenges                          # auth challenge issuance
pnpm test:load:stress                                   # ramp to 2000 rps
pnpm test:load:concurrent                               # ramp to 2000 concurrent users
pnpm test:load:all                                      # smoke + search + health
pnpm test:load:ci                                       # smoke then search, abort-on-fail
```

## Configuration

| Variable     | Default                 | Purpose                                  |
| :----------- | :---------------------- | :--------------------------------------- |
| `BASE_URL`   | `http://localhost:8080` | Backend base URL                         |
| `JWT_SECRET` | —                       | Secret for generating test JWTs          |
| `PEAK_RPS`   | `2000`                  | Peak RPS for stress test                 |
| `VUS`        | `2000`                  | Max concurrent users for concurrent test |
