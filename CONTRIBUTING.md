# Contributing

Thanks for wanting to contribute. This document is the **human contributor workflow** — environment setup, branch + commit conventions, and the PR process. It is **not** a workspace rulebook.

For security issues, see [parity.io/bug-bounty](https://parity.io/bug-bounty) for the disclosure process. For everything else, this file is the entry point.

## Prerequisites

| Tool       | Version                | Purpose                      |
| ---------- | ---------------------- | ---------------------------- |
| Node.js    | 24+                    | Development runtime          |
| pnpm       | 10.28.2 (via corepack) | Package manager              |
| Bun        | latest                 | Production runtime           |
| PostgreSQL | 15+                    | Database                     |
| Docker     | any                    | Local PostgreSQL + e2e tests |

```bash
corepack enable
corepack pnpm --version   # should print 10.28.2
bun --version
```

## Quick Start

```bash
git clone <repo-url>
cd identity-backend
corepack pnpm install                                                # postinstall builds all packages
cp apps/identity-backend/.env.example apps/identity-backend/.env
docker run -d --name identity-postgres \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=identity \
  -p 5432:5432 postgres:18
pnpm db:migrate
pnpm check:ci                                                        # typecheck + lint
pnpm test                                                            # unit + integration
pnpm --filter identity-backend-container dev                        # http://localhost:8080
```

Local dev defaults are pre-set in `.env.example` — `AUTH_ENABLED=false`, `ENFORCE_AUTH=false`.

## Branching

Branch off `main` via the worktree manager — never directly on `main`:

```bash
wt switch --create feat/<short-name>
wt switch --create fix/<short-name>
wt switch --create chore/<short-name>
```

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), 16 types, **no scopes**, ≤72 char lower-case header. Examples:

```bash
feat: add username reservation endpoint
fix: prevent attestation replay on duplicate nonce
chore: bump oxlint to 0.9.0
```

`commit-msg` (Husky) validates every commit. CI re-validates with `commitlint`.

## Submitting a Pull Request

1. **Run pre-push locally** before opening the PR:
   ```bash
   pnpm check:ci     # typecheck + lint
   pnpm test         # unit + integration
   pnpm test:e2e:local   # if you touched cross-service boundaries
   ```
2. **Open the PR against `main`** with a conventional commit title and a description that links to the spec/issue and states the test plan.
3. **CI runs automatically**: lint, typecheck, unit tests, e2e, commit lint, env-sync, migration-check. A green PR clears all of them.
4. **Address review feedback in the same PR** unless the reviewer asks for a follow-up. Keep PRs small and focused (<500 lines, <10 files).
5. **After merge**: `wt remove` to clean up the worktree.

PR template: `.github/PULL_REQUEST_TEMPLATE.md`.

## Code Style

Effect-TS is mandatory for async, path aliases are `#root/*` for `apps/identity-backend/`, and type suppression (`as any`, `@ts-ignore`, `@ts-expect-error`, empty catch) is forbidden. Each app's leaf `AGENTS.md` under `apps/<name>/` may add per-domain rules; read them when working in that app.

## Testing

Vitest + `@effect/vitest` + `fast-check` for PBT. To run:

```bash
pnpm test                       # unit + integration (excludes e2e)
pnpm test:run -- <path>         # one file
pnpm test:e2e:local             # full Docker stack
```

## Troubleshooting

| Symptom                           | Fix                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm install` engine mismatch    | `node --version` should be v24+. `eval "$(fnm env)" && fnm use`                      |
| Build fails after pulling main    | `pnpm install && pnpm build`                                                         |
| PostgreSQL connection refused     | `docker ps \| grep identity-postgres` — start it with `docker compose up -d` if down |
| Worktree conflicts on `wt switch` | Resolve uncommitted changes in the current worktree, commit, then retry              |

## Getting Help

- **Bug reports / feature requests** → GitHub issues
- **Security issues** → private disclosure to `security@parity.io` (see [parity.io/bug-bounty](https://parity.io/bug-bounty))
