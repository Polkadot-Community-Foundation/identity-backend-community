# syntax=docker/dockerfile:1-labs
FROM node:24-slim@sha256:242549cd46785b480c832479a730f4f2a20865d61ea2e404fdb2a5c3d3b73ecf AS base



ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV npm_config_store_dir="/pnpm/store"

RUN corepack enable

FROM base AS deps-identity
WORKDIR /usr/src/app
COPY --link --from=prune-identity json/ .
COPY --link --from=prune-identity pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=shared \
    --mount=type=bind,from=pnpm-store,target=/pnpm-seed \
    [ -z "$(ls -A /pnpm/store 2>/dev/null)" ] && cp -r /pnpm-seed/. /pnpm/store/ || true; \
    pnpm fetch --frozen-lockfile && \
    pnpm install --prefer-offline --frozen-lockfile --ignore-scripts

FROM deps-identity AS build-identity
COPY --link --from=prune-identity full/ .
COPY --link --from=turbo-cache . /usr/src/app/.turbo
RUN CI=true pnpm exec turbo build --filter=identity-backend-container...
RUN touch packages/descriptors/.papi/descriptors/.npmignore
RUN pnpm deploy --filter=identity-backend-container --prod --legacy /prod/app

FROM base AS deps-api-docs
WORKDIR /usr/src/app
COPY --link --from=prune-api-docs json/ .
COPY --link --from=prune-api-docs pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=shared \
    --mount=type=bind,from=pnpm-store,target=/pnpm-seed \
    [ -z "$(ls -A /pnpm/store 2>/dev/null)" ] && cp -r /pnpm-seed/. /pnpm/store/ || true; \
    pnpm fetch --frozen-lockfile && \
    pnpm install --prefer-offline --frozen-lockfile --ignore-scripts

FROM deps-api-docs AS build-api-docs
COPY --link --from=prune-api-docs full/ .
COPY --link --from=turbo-cache . /usr/src/app/.turbo
RUN CI=true pnpm exec turbo build --filter=@polkadot-app/api-docs...

FROM base AS deps-e2e
WORKDIR /usr/src/app
COPY --link --from=prune-e2e json/ .
COPY --link --from=prune-e2e pnpm-lock.yaml .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store,sharing=shared \
    --mount=type=bind,from=pnpm-store,target=/pnpm-seed \
    [ -z "$(ls -A /pnpm/store 2>/dev/null)" ] && cp -r /pnpm-seed/. /pnpm/store/ || true; \
    pnpm fetch --frozen-lockfile && \
    pnpm install --prefer-offline --frozen-lockfile --ignore-scripts

FROM deps-e2e AS build-e2e
COPY --link --from=prune-e2e full/ .
COPY --link --from=turbo-cache . /usr/src/app/.turbo
RUN CI=true pnpm exec turbo build --filter=identity-backend-e2e-people-startup-container...
RUN touch packages/descriptors/.papi/descriptors/.npmignore
RUN pnpm deploy --filter=identity-backend-e2e-people-startup-container --prod --legacy /prod/app

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS app-identity



COPY --link --from=build-identity /prod/app /prod/app
COPY --link --from=build-api-docs /usr/src/app/apps/api-docs/dist /prod/app/static

WORKDIR /prod/app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

USER bun
EXPOSE 8080/tcp

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/healthcheck || exit 1

CMD ["sh", "-c", "bun run db:migrate && exec bun run start"]

FROM oven/bun:1.3.13@sha256:87416c977a612a204eb54ab9f3927023c2a3c971f4f345a01da08ea6262ae30e AS app-e2e

COPY --link --from=build-e2e /prod/app /prod/app

WORKDIR /prod/app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

USER bun
EXPOSE 8080/tcp

ENV NODE_ENV=production

CMD bun run start
