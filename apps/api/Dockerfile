# Build context is the repository root, so the workspace can be installed as one.
#
# There is no compile step for the API itself: Node 26 strips TypeScript types
# natively. Only @prism/shared is built, because Node refuses to strip types for
# files resolved inside node_modules, which is how the workspace link resolves.

FROM node:26-slim AS build
WORKDIR /app

# Manifests first: this layer is cached until a dependency actually changes.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/e2e/package.json ./apps/e2e/
RUN npm ci

COPY packages/shared ./packages/shared
RUN npm run build --workspace @prism/shared

# The API's own production packages, installed from the manifests alone: no
# storefront packages and no dev tools, in a layer that changes only when a
# dependency does.
FROM node:26-slim AS packages
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/e2e/package.json ./apps/e2e/
RUN npm ci --omit=dev --workspace @prism/api

FROM node:26-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

RUN mkdir -p /srv/media && chown node:node /srv/media

COPY --from=packages --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/shared/dist /app/packages/shared/dist
COPY --chown=node:node apps/api /app/apps/api

USER node
WORKDIR /app/apps/api
EXPOSE 8080

CMD ["node", "src/main.ts"]
