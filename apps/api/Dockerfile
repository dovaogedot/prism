# Build context is the repository root, so the workspace can be installed as one.
#
# There is no compile step for the API itself: Node 26 strips TypeScript types
# natively. Only @prism/shared is built, because Node refuses to strip types for
# files resolved inside node_modules, which is how the workspace link resolves.

FROM node:26-slim AS build
WORKDIR /app

# argon2 builds a native addon when no prebuild matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Manifests first: this layer is cached until a dependency actually changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci

COPY packages/shared ./packages/shared
RUN npm run build --workspace @prism/shared

COPY apps/api ./apps/api

# Drops typescript, vitest and the test containers from the runtime image.
RUN npm prune --omit=dev

FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /srv/media && chown node:node /srv/media

COPY --from=build --chown=node:node /app /app

USER node
WORKDIR /app/apps/api
EXPOSE 8080

CMD ["node", "src/main.ts"]
