# check=skip=SecretsUsedInArgOrEnv
# Build context is the repository root.
#
# The build checks are told to let `VITE_RECAPTCHA_SITE_KEY` through: a
# reCAPTCHA site key is public, since the widget hands it to every visitor's
# browser, and only the secret key on the API has to be kept.

FROM node:26-slim AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/e2e/package.json ./apps/e2e/
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
RUN npm run build --workspace @prism/shared

# Vite inlines these at build time, so they must arrive before the build runs.
ARG VITE_RECAPTCHA_SITE_KEY=
ENV VITE_RECAPTCHA_SITE_KEY=$VITE_RECAPTCHA_SITE_KEY

COPY apps/web ./apps/web
RUN npm run build --workspace @prism/web

FROM caddy:2-alpine AS runtime

# openssl makes the self-signed certificate on the first start; /tls is where
# it is kept, a volume in Compose.
RUN apk add --no-cache openssl && mkdir -p /tls

COPY --chmod=755 apps/web/entrypoint.sh /usr/local/bin/entrypoint
COPY --chmod=755 apps/web/healthcheck.sh /usr/local/bin/healthcheck
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint"]
