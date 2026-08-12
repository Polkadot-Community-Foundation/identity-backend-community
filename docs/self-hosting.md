# Running your own identity-backend

> [!WARNING]
> This is a prototype and reference implementation. The image is **not audited**, ships with
> authentication **disabled by default**, and is intended for local development, testing and
> experimentation — not for production use. See the [security notes](../README.md#security).

This page is for people who want to run their **own** instance — typically pointed at their own
chain — without building from source and without any PCF/Google Cloud credentials.

If you are operating the production deployment instead, start at [`infra/README.md`](../infra/README.md).

## The image

```
ghcr.io/polkadot-community-foundation/identity-backend-community
```

| Tag                       | Meaning                                                    |
| ------------------------- | ---------------------------------------------------------- |
| `vX.Y.Z`                  | A published release. Pin this.                             |
| `latest`                  | Moving tag, points at the most recent release.             |
| `<YYYYMMDD-HHMMSS>-<sha>` | An ad-hoc build published by hand; never becomes `latest`. |

Images are published **on releases only** — merging to `main` does not publish one.

Built by [`.github/workflows/publish-public-image.yml`](../.github/workflows/publish-public-image.yml)
from the `app-identity` target of the root [`Dockerfile`](../Dockerfile) — the same artifact that
runs in the PCF deployment. It contains **no credentials**: every key and secret is injected at
runtime through the environment.

Currently published for **`linux/amd64` only**. On Apple silicon it runs under emulation.

## Quick start

You need a PostgreSQL 18 database and a People-chain RPC endpoint. The container runs its own
migrations on start.

First, the chain account. `PROXY_PRIVATE_KEY` is the sr25519 64-byte _expanded_ secret of the
account that submits extrinsics, and `ATTESTER_PUBLIC_KEY` is the attester authority's public key.
Generate your own:

```bash
export PROXY_PRIVATE_KEY=$(pnpm --silent tsx apps/identity-backend/scripts/private-key.ts)
export ATTESTER_PUBLIC_KEY=0x...   # public key of your attester authority
```

Several other required variables are credentials for services a local instance never actually
calls (Google Play Integrity, Apple Push, TURN). They are still demanded at startup, so generate
throwaway values too:

```bash
# Apple Push signing key — any PKCS#8 EC P-256 key, base64-encoded
export APN_PRIVATE_KEY=$(openssl ecparam -genkey -name prime256v1 -noout \
  | openssl pkcs8 -topk8 -nocrypt | base64 -w0)

# Google service-account credentials — base64-encoded JSON of the usual shape
export GOOGLE_CREDENTIALS=$(openssl genrsa 2048 2>/dev/null \
  | openssl pkcs8 -topk8 -nocrypt \
  | jq -Rs '{type:"service_account",project_id:"example",private_key_id:"example",
             private_key:.,client_email:"example@example.iam.gserviceaccount.com",
             client_id:"100000000000000000000",
             auth_uri:"https://accounts.google.com/o/oauth2/auth",
             token_uri:"https://oauth2.googleapis.com/token",
             auth_provider_x509_cert_url:"https://www.googleapis.com/oauth2/v1/certs",
             client_x509_cert_url:"https://www.googleapis.com/robot/v1/metadata/x509/example",
             universe_domain:"googleapis.com"}' | base64 -w0)
```

```bash
docker network create identity-backend

docker run -d --name identity-postgres --network identity-backend \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=identity \
  postgres:18

docker run -d --name identity-backend --network identity-backend -p 8080:8080 \
  -e PORT=8080 \
  -e DATABASE_URL="postgresql://postgres:postgres@identity-postgres:5432/identity" \
  -e PEOPLE_NETWORK=paseo \
  -e PEOPLE_RPC_ENDPOINTS="wss://people-paseo.rotko.net" \
  -e PEOPLE_CHAIN_DESCRIPTOR=paseo_people \
  -e ATTESTER_PUBLIC_KEY="$ATTESTER_PUBLIC_KEY" \
  -e PROXY_PRIVATE_KEY="$PROXY_PRIVATE_KEY" \
  -e JWT_AUTH_SECRET="$(openssl rand -hex 32)" \
  -e GOOGLE_CREDENTIALS="$GOOGLE_CREDENTIALS" \
  -e APN_PRIVATE_KEY="$APN_PRIVATE_KEY" \
  -e APN_KEY_ID=0000000000 \
  -e APN_TEAM_ID=AAAAAAAAAA \
  -e ANDROID_PACKAGE_NAMES=io.example.app \
  -e ANDROID_SIGNING_DIGEST_PLAYSTORE=$(printf 'a%.0s' {1..64}) \
  -e ANDROID_SIGNING_DIGEST_WEBSITE=$(printf 'b%.0s' {1..64}) \
  -e TURN_SECRET="$(openssl rand -base64 32)" \
  -e TURN_REALM=placeholder \
  ghcr.io/polkadot-community-foundation/identity-backend-community:latest

curl http://localhost:8080/healthcheck
# {"uptime":2.2,"responseTime":[2,229370216],"message":"OK","timestamp":1786546961744}
```

Every credential above is generated locally by the commands in this section. Nothing in this
document is a usable key, and none should be copied from anywhere else.

> [!NOTE]
> `PORT=8080` is not optional. The application defaults to port 3000, but the image's built-in
> `HEALTHCHECK` probes `localhost:8080`, so leaving `PORT` unset produces a container that serves
> traffic on 3000 while Docker reports it as `unhealthy`.

## Pointing it at your own chain

Chain selection is entirely runtime configuration — you do not need to rebuild to change chains,
**as long as the target chain's runtime metadata matches one of the descriptors baked into the
image** (see the ceiling below).

| Variable                  | Purpose                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PEOPLE_RPC_ENDPOINTS`    | Comma-separated WSS/WS endpoints for the People chain. This is the actual connection target — point it anywhere, including a local node or a Chopsticks fork.        |
| `PEOPLE_CHAIN_DESCRIPTOR` | Which baked PAPI descriptor is used to _encode_ calls. One of `previewnet_people`, `paseo_people`, `paseo_people_next`. Defaults to `previewnet_people`.             |
| `PEOPLE_NETWORK`          | A **label**, not a connection setting: `westend2`, `polkadot` or `paseo`. Selects the descriptor used by the individuality indexer and tags invitation-ticket state. |
| `ASSET_HUB_RPC_ENDPOINTS` | Asset Hub endpoints. Only consumed when `DOTNS_GATEWAY_ENABLED=true`.                                                                                                |

Pick the descriptor whose runtime the target chain actually matches — a mismatch surfaces as
decoding failures or `ChainNotSupported`-style errors at the first call, not at startup.

### The descriptor ceiling

The image carries a fixed set of pre-generated chain descriptors
([`packages/descriptors/.papi/polkadot-api.json`](../packages/descriptors/.papi/polkadot-api.json),
with the metadata committed as `.scale` files). This makes builds hermetic, but it means:

1. **People chain** — you may choose among the three descriptors listed above and nothing else.
2. **Asset Hub** — there is no environment knob at all. The typed API is hardcoded to
   `previewnet_asset_hub` in
   [`asset-hub-typed-api.service.ts`](../apps/identity-backend/src/infrastructure/adapters/blockchain/asset-hub-typed-api.service.ts).
   Only relevant if you enable the dotNS gateway.
3. **A chain whose runtime differs from all of them** — for example a custom or locally developed
   runtime — needs a descriptor of its own, which means a **rebuild**:

   ```bash
   pnpm --filter @identity-backend/descriptors exec papi add my_people -w wss://my-node:443
   ```

   That writes `packages/descriptors/.papi/metadata/my_people.scale` and registers the entry in
   `polkadot-api.json`. You then have to widen three places by hand before rebuilding the image:
   the `PEOPLE_CHAIN_DESCRIPTOR` literal in
   [`config.ts`](../apps/identity-backend/src/config.ts), the descriptor union in
   [`people-typed-api.service.ts`](../apps/identity-backend/src/infrastructure/adapters/blockchain/people-typed-api.service.ts),
   and — if you run the individuality indexer — its own separate `PEOPLE_NETWORK`-to-descriptor
   mapping in
   [`individuality-indexer.worker.ts`](../apps/identity-backend/src/supervision/individuality-indexer/workers/individuality-indexer.worker.ts).

If you hit this, please open an issue describing the chain — making the descriptor set
configurable rather than hardcoded is tracked work, and knowing the concrete target helps.

### Forking a live chain locally

If what you want is your own instance against a _fork_ of an existing chain, the repository already
has that stack: [`docker/test/e2e/`](../docker/test/e2e/) runs Chopsticks forks of a People chain and
an Asset Hub, plus a startup container that provisions the proxies and attestation allowances the
backend expects. See its [README](../docker/test/e2e/README.md).

## Configuration reference

[`apps/identity-backend/.env.example`](../apps/identity-backend/.env.example) is the canonical,
annotated list of every variable with its defaults. Everything not listed below has a working
default or is inert while its feature flag is off.

These are the variables the container genuinely refuses to start without — established by
booting the image and removing them one at a time, not by reading the config schema:

| Variable                                                                                      | Notes                                                                                                           |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `PORT`                                                                                        | Set to `8080` — see the note above.                                                                             |
| `DATABASE_URL`                                                                                | PostgreSQL connection string. Migrations run automatically at container start.                                  |
| `PEOPLE_RPC_ENDPOINTS`                                                                        | See above.                                                                                                      |
| `PEOPLE_NETWORK`                                                                              | See above.                                                                                                      |
| `PROXY_PRIVATE_KEY`                                                                           | sr25519 64-byte expanded private key of the submitting account.                                                 |
| `ATTESTER_PUBLIC_KEY`                                                                         | Hex public key of the attester authority.                                                                       |
| `JWT_AUTH_SECRET`                                                                             | Any strong random string.                                                                                       |
| `GOOGLE_CREDENTIALS`                                                                          | Base64 JSON service-account for Play Integrity. Required even with `AUTH_ENABLED=false`. Throwaway value works. |
| `APN_PRIVATE_KEY`, `APN_KEY_ID`, `APN_TEAM_ID`                                                | Apple Push credentials. Required even though nothing here sends push. Throwaway values work.                    |
| `ANDROID_PACKAGE_NAMES`, `ANDROID_SIGNING_DIGEST_PLAYSTORE`, `ANDROID_SIGNING_DIGEST_WEBSITE` | Android attestation config. The two digests are 64 hex chars; any value parses.                                 |
| `TURN_SECRET`, `TURN_REALM`                                                                   | See the warning below.                                                                                          |

Everything else in `.env.example` has a working default or is inert behind a flag. Notably
**optional**: `PEOPLE_CHAIN_DESCRIPTOR` (defaults to `previewnet_people`), `AUTH_ENABLED` and
`ENFORCE_AUTH` (both default false), `ASSET_HUB_RPC_ENDPOINTS` (only consumed when
`DOTNS_GATEWAY_ENABLED=true`), `APN_TOPICS`, `TURN_TTL`, `TURN_AUTH_ALGORITHM`, `ICE_SERVERS`,
`ANDROID_ATTESTATION_CRL_*`, and every daemon-enable flag.

Set `ATTESTER_PROXY_PRIVATE_KEY` as well if you enable `PROXY_DELEGATION_ENABLED=true`.

### Two startup traps

Most missing variables produce a clear fatal error naming the variable:

```
FATAL ERROR: An unrecoverable error occurred
Missing data at APN_PRIVATE_KEY: "Expected APN_PRIVATE_KEY to exist in the process context"
```

> [!WARNING]
> **`TURN_SECRET` and `TURN_REALM` are the exception.** Omit either and the container runs its
> migrations, logs nothing further, and **exits with status 0** — no error, no mention of TURN.
> A silent, successful-looking exit almost always means one of these two is missing.

`APN_PRIVATE_KEY` is a base64-encoded PKCS#8 EC key, so any throwaway P-256 key satisfies it:

```bash
openssl ecparam -genkey -name prime256v1 -noout | openssl pkcs8 -topk8 -nocrypt | base64 -w0
```

On-chain writes (username registration, invitation tickets) additionally require that the attester
account actually holds the relevant allowances and proxy relationships on your chain — a
correctly configured backend against an unprovisioned chain will start cleanly and then fail at
submission time. See [`infra/docs/polkadot-attester-onchain.md`](../infra/docs/polkadot-attester-onchain.md).

## What you do not get by default

- **Authentication is off.** `AUTH_ENABLED` and `ENFORCE_AUTH` default to `false`, which makes the
  Play Integrity / App Attest middleware a pass-through. That is deliberate for local development
  and unsafe anywhere else.
- **Push notifications, TURN and the dotNS gateway are off** until their credentials and flags are
  supplied — see `.env.example`.
- **No observability wiring.** Point `OTEL_EXPORTER_OTLP_ENDPOINT` at a collector if you want
  traces; [`docker/local/`](../docker/local/) has a ready-made Grafana/Tempo/Prometheus stack.
