# Build context is the repository root.

FROM node:26-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
RUN npm run build --workspace @prism/shared

# Vite inlines these at build time, so they must arrive before the build runs.
ARG VITE_CAPTCHA_MODE=test
ARG VITE_RECAPTCHA_SITE_KEY=
ENV VITE_CAPTCHA_MODE=$VITE_CAPTCHA_MODE
ENV VITE_RECAPTCHA_SITE_KEY=$VITE_RECAPTCHA_SITE_KEY

COPY apps/web ./apps/web
RUN npm run build --workspace @prism/web

FROM caddy:2-alpine AS runtime

COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

EXPOSE 3000
