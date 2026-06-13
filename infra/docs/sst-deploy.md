# SST v3 Deploy — Operator Reference

> Canonical SST v3 / Pulumi-under-the-hood facts the rest of the operator
> manual assumes. Read this if you need the deploy-time mental model. The
> four-command operator workflow is in `infra/README.md`; this file is the
> reference for the moving parts.

## The single SST app

`sst.config.ts` at the repo root is the **only** deployment entry point.
It defines one `$config({ app(input) { … }, async run() { … } })` block.

```bash
pnpm sst deploy --stage <stage>     # apply IaC + build + push + roll
pnpm sst diff   --stage <stage>     # build + show pending resource changes
pnpm sst remove --stage <stage>     # tear down (dangerous in prod)
pnpm sst refresh --stage <stage>    # reconcile state with reality
```

Per-stage state is held in the Pulumi backend (Pulumi Cloud free tier by
default, or an S3 + DynamoDB backend if `PULUMI_BACKEND_URL` is set).
`pnpm sst deploy` is **idempotent** and the lock is held in the backend.

## What `sst deploy` actually does

1. Loads `sst.config.ts` (TypeScript, executed in-process).
2. Resolves `appDeploymentEnvironment()` and `appDeploymentConfig()` —
   reads `sst.Secret` values from AWS Secrets Manager and reads
   deployment config from `process.env` / `.env` at the repo root.
3. Calls each module in `infra/` (`observability.ts`, `vpc-endpoints.ts`,
   `service.ts`, `edge.ts`) — these import the SST-injected globals
   (`$config`, `sst`, `cloudflare`, `$util`, `$interpolate`).
4. Synthesizes a Pulumi program and runs `pulumi up` under the hood.
5. The new container image is built from the `app-identity` stage of
   `Dockerfile`, pushed to ECR, and the ECS service is rolled
   (deployment circuit breaker rolls back on a bad health check).

## `.env` file semantics

Pulumi auto-loads `.env` from the workspace root when `sst` runs.
Key behavior:

- **The `.env` file is read once, at deploy time.** It is NOT shipped
  to the container and NOT committed to git (the existing `.gitignore`
  excludes it).
- `process.env` overrides `.env` if both are set.
- There is no `.env.<stage>` automatic loading — for per-stage config
  use either (a) `STAGE=<stage> FOO=bar pnpm sst deploy` or
  (b) keep one `.env` and manage stage differences via secret rotation.
- 11 of the 12 deployment config keys (`sst.config.ts#DEPLOYMENT_CONFIG`)
  **throw at deploy time** if missing. `PEOPLE_NETWORK` defaults to
  `'westend2'`. The error names the missing key.

## `sst.Secret` lifecycle

- Each `sst.Secret('NAME')` is backed by an entry in **AWS Secrets
  Manager** (not SSM — the SST v3 default for the TS config). One secret
  per declared name, with the per-stage suffix pattern
  `identity-backend/<stage>/NAME` (confirm with
  `aws secretsmanager list-secrets --filter Key=name,Values=identity-backend`).
- The IAM task role is granted `secretsmanager:GetSecretValue` +
  `DescribeSecret` scoped to `arn:aws:secretsmanager:*:*:secret:identity-backend-*`.
- **Rotation:** the next `sst deploy` after a `sst secret set` picks up
  the new value, and the next task replacement rolls a fresh container
  with the new env var. Running tasks are NOT hot-reloaded — they hold
  the value they read at task start. A `force-new-deployment` rolls the
  fleet immediately; otherwise tasks restart on the normal schedule.
- **Cross-stage isolation:** secrets are namespaced by stage. Setting
  `JWT_AUTH_SECRET` on `dev` does not affect `production`.

## `sst.Linkable` and `link: [database]`

`link` is SST v3's typed dependency-injection. `sst.aws.Postgres` exposes
its `host`, `port`, `username`, `password`, `database` as outputs; the
service component reads them and builds a `DATABASE_URL` (see
`infra/service.ts` line 12-14). The container never sees an unlinked
endpoint — `DATABASE_URL` is injected from `$interpolate` and the
operator never sets it.

## `sst shell` and `sst console`

- **`pnpm sst shell --stage <stage>`** opens an interactive shell in the
  same runtime as the deploy, with the link outputs pre-resolved. Use
  for one-off commands against the live infra (e.g. `psql $(sst shell
  --command 'echo $DATABASE_URL')`).
- **`pnpm sst console --stage <stage>`** opens the SST web console for
  the stage — resource map, recent deploys, links to logs.

## `sst logs`

> ⚠️ **SST v3 removed the `sst logs` command.** Logs are reached via the
> SST console or directly via the CloudWatch Logs tail CLI:
>
> ```bash
> aws logs tail /ecs/identity-backend-<stage> --follow --filter-pattern "ERROR"
> ```

## Pinned provider versions in `sst.config.ts#app().providers`

The two pinned versions exist on the **current Pulumi line**. Bumping
follows the rule "verify on npm first, bump the three files together":

| Provider             | Pinned version | Source                                      |
| -------------------- | -------------- | ------------------------------------------- |
| `@pulumi/aws`        | `7.32.0`       | `sst.config.ts#app().providers.aws.version` |
| `@pulumi/cloudflare` | `6.17.0`       | `sst.config.ts#app().providers.cloudflare`  |

> **Note:** the v6 track of `@pulumi/aws` topped out at `6.66.2`;
> the current pin is on the v7 line because `sst@4` requires
> `@pulumi/aws >= 7.20.0`. Bumping the version in `sst.config.ts`
> must be done in lockstep with this table.

A version that does not exist on the registry causes the install to
fail with `provider <name> not found` after every candidate package
name 404s — the error blames the name, the bug is the version. See
`infra/AGENTS.md` for the invariant.

## Sources

- SST v3 docs: <https://sst.dev/docs/>
- SST CLI reference: <https://sst.dev/docs/reference/cli>
- `sst.Secret` construct: <https://sst.dev/docs/constructs/secret>
- `sst.Linkable`: <https://sst.dev/docs/constructs/linkable>
- Pulumi backend (state): <https://sst.dev/docs/reference/state>
