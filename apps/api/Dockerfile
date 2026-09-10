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

# The stills of every color's and every finisher's scene, drawn by the
# storefront's own stages in a headless browser. Only what the pictures are
# made of is copied in, so the render runs again when a scene or the planned
# catalog changes and comes from the cache otherwise.
FROM node:26-slim AS stills
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --ignore-scripts

# Chromium, and Mesa for it to rasterize through: see `RASTERIZER` in the
# script that drives it.
RUN npx playwright install --with-deps chromium \
 && apt-get install -y --no-install-recommends libgl1 libgl1-mesa-dri libegl1 libgles2 \
 && rm -rf /var/lib/apt/lists/*

COPY packages/shared ./packages/shared
RUN npm run build --workspace @prism/shared

COPY apps/api/src/db/stills.ts apps/api/src/db/plan.ts apps/api/src/db/palette.ts \
     apps/api/src/db/seed-data.ts apps/api/src/db/schema.ts ./apps/api/src/db/
COPY apps/web/stills.html apps/web/vite.config.ts ./apps/web/
COPY apps/web/public ./apps/web/public
COPY apps/web/scripts ./apps/web/scripts
COPY apps/web/src/stills ./apps/web/src/stills
COPY apps/web/src/features/catalog/artwork ./apps/web/src/features/catalog/artwork
COPY apps/web/src/shared/theme ./apps/web/src/shared/theme

RUN node apps/api/src/db/stills.ts > /tmp/still-jobs.json \
 && npm run stills --workspace @prism/web -- /tmp/still-jobs.json /stills

FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /srv/media && chown node:node /srv/media

COPY --from=build --chown=node:node /app /app
COPY --from=stills --chown=node:node /stills /app/stills

USER node
WORKDIR /app/apps/api
EXPOSE 8080

CMD ["node", "src/main.ts"]
