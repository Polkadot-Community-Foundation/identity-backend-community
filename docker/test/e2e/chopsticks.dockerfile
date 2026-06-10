# Stage 1: Install chopsticks with pnpm patches applied
FROM node:24-alpine@sha256:2bdb65ed1dab192432bc31c95f94155ca5ad7fc1392fb7eb7526ab682fa5bf14 AS patcher

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

WORKDIR /build

# Create minimal package.json for chopsticks installation
RUN echo '{ \
  "name": "chopsticks-patcher", \
  "private": true, \
  "type": "module", \
  "packageManager": "pnpm@10.20.0", \
  "dependencies": { \
    "@acala-network/chopsticks": "1.4.1", \
    "@acala-network/chopsticks-core": "1.4.1" \
  }, \
  "pnpm": { \
    "patchedDependencies": { \
      "@acala-network/chopsticks-core": "patches/@acala-network__chopsticks-core.patch", \
      "@acala-network/chopsticks": "patches/@acala-network__chopsticks.patch" \
    } \
  } \
}' > package.json

# Copy patches from the patches/ directory (NOT in .dockerignore)
COPY patches/@acala-network__chopsticks-core.patch patches/
COPY patches/@acala-network__chopsticks.patch patches/

COPY --from=pnpm-store . /pnpm/store
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile=false

# Stage 2: Final chopsticks image with patched files
FROM acala/chopsticks:1.2.5@sha256:7b7abc76bebe20231b99d88bae037d6d467751507ca8749d8cca38324a08844d

ENV CONFIG_FILE=pop-testnet.json

RUN apk add --no-cache curl

# Apply patched files from pnpm install
# server.js - WebSocket heartbeat handling
COPY --from=patcher /build/node_modules/@acala-network/chopsticks/dist/esm/server.js /usr/local/lib/node_modules/@acala-network/chopsticks/dist/esm/server.js

# blockchain/index.js - Accept validation errors when mockSignatureHost is enabled
COPY --from=patcher /build/node_modules/@acala-network/chopsticks-core/dist/esm/blockchain/index.js /usr/local/lib/node_modules/@acala-network/chopsticks/node_modules/@acala-network/chopsticks-core/dist/esm/blockchain/index.js
COPY --from=patcher /build/node_modules/@acala-network/chopsticks-core/dist/cjs/blockchain/index.js /usr/local/lib/node_modules/@acala-network/chopsticks/node_modules/@acala-network/chopsticks-core/dist/cjs/blockchain/index.js

# txpool.js - Handle extrinsic decoding errors gracefully
COPY --from=patcher /build/node_modules/@acala-network/chopsticks-core/dist/cjs/blockchain/txpool.js /usr/local/lib/node_modules/@acala-network/chopsticks/node_modules/@acala-network/chopsticks-core/dist/cjs/blockchain/txpool.js

# setup.js - Accept custom signed extensions from config
COPY --from=patcher /build/node_modules/@acala-network/chopsticks-core/dist/esm/setup.js /usr/local/lib/node_modules/@acala-network/chopsticks/node_modules/@acala-network/chopsticks-core/dist/esm/setup.js
COPY --from=patcher /build/node_modules/@acala-network/chopsticks-core/dist/cjs/setup.js /usr/local/lib/node_modules/@acala-network/chopsticks/node_modules/@acala-network/chopsticks-core/dist/cjs/setup.js

# context.js - Load custom signed extensions from /app/ when config requires it
COPY --from=patcher /build/node_modules/@acala-network/chopsticks/dist/esm/context.js /usr/local/lib/node_modules/@acala-network/chopsticks/dist/esm/context.js
COPY --from=patcher /build/node_modules/@acala-network/chopsticks/dist/cjs/context.js /usr/local/lib/node_modules/@acala-network/chopsticks/dist/cjs/context.js

# schema/index.js - Allow signed-extensions property in config
COPY --from=patcher /build/node_modules/@acala-network/chopsticks/dist/esm/schema/index.js /usr/local/lib/node_modules/@acala-network/chopsticks/dist/esm/schema/index.js
COPY --from=patcher /build/node_modules/@acala-network/chopsticks/dist/cjs/schema/index.js /usr/local/lib/node_modules/@acala-network/chopsticks/dist/cjs/schema/index.js

WORKDIR /app

# Copy config files
COPY docker/test/e2e/*.json ./

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=10s --start-period=120s --retries=10 \
  CMD curl -v http://localhost:8000 || exit 1

CMD chopsticks -c "$CONFIG_FILE"
