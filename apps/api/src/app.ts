/**
 * The composition root.
 *
 * This is the only file that knows which adapter implements which port. Every
 * module below it receives its dependencies as arguments, which is what lets
 * the integration tests build the same application with a fake clock and a
 * memory mailer and exercise the real routes against them.
 */

import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import fastifyHelmet from "@fastify/helmet";
import fastifyMultipart from "@fastify/multipart";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { OAUTH_PROVIDERS, Option } from "@prism/shared";
import Fastify, { type FastifyInstance } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { registerErrorHandler } from "./http/errors.ts";
import { createGuards, registerAuthenticatedDecorator } from "./http/guard.ts";
import { createTtlCache } from "./platform/cache.ts";
import {
  createGoogleCaptchaVerifier,
  createTestCaptchaVerifier,
  type CaptchaVerifier,
} from "./platform/captcha.ts";
import { systemClock, type Clock } from "./platform/clock.ts";
import { argon2Hasher, type Hasher } from "./platform/hasher.ts";
import { createSmtpMailer, type Mailer } from "./platform/mailer.ts";
import {
  createGitHubOAuthProvider,
  createGoogleOAuthProvider,
  createMockOAuthProvider,
  createOAuthRegistry,
  type OAuthRegistry,
} from "./platform/oauth.ts";
import { createFileMediaStorage } from "./platform/storage.ts";
import { createTokenService } from "./platform/tokens.ts";
import { createTotpService } from "./platform/totp.ts";
import { createAuthRepository } from "./modules/auth/repository.ts";
import { registerAuthRoutes } from "./modules/auth/routes.ts";
import { createAuthService } from "./modules/auth/service.ts";
import { createCatalogRepository } from "./modules/catalog/repository.ts";
import {
  registerCatalogRoutes,
  registerMediaRoutes,
} from "./modules/catalog/routes.ts";
import { createCatalogService } from "./modules/catalog/service.ts";

/** Tests substitute the pieces that would otherwise reach the outside world. */
export type AppOverrides = Readonly<{
  clock?: Clock;
  hasher?: Hasher;
  mailer?: Mailer;
  captcha?: CaptchaVerifier;
  oauth?: OAuthRegistry;
}>;

/** Everything the application is built from. */
export type AppInput = Readonly<{
  config: Config;
  database: DatabaseHandle;
  overrides?: AppOverrides;
}>;

const API_PREFIX = "/api/v1";

/**
 * The composition root: builds every adapter and wires the modules onto them.
 *
 * Anything named in `overrides` is used in place of the real adapter, which is
 * how the tests run the real logic against a fake clock and an in-memory mailer.
 */
export const buildApp = async (input: AppInput): Promise<FastifyInstance> => {
  const { config, database } = input;
  const overrides = input.overrides ?? {};

  const app = Fastify({
    logger: { level: config.logLevel },
    // Caddy terminates the connection, so the client's address arrives in a
    // header. Without this every request appears to come from the proxy and
    // rate limiting becomes global rather than per-client.
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  /* ------------------------------------------------------------- adapters */

  const clock = overrides.clock ?? systemClock;
  const hasher = overrides.hasher ?? argon2Hasher;

  const tokens = createTokenService({
    secret: config.tokens.secret,
    issuer: config.tokens.issuer,
    accessTtlSeconds: config.tokens.accessTtlSeconds,
    twoFactorChallengeTtlSeconds: config.tokens.twoFactorChallengeTtlSeconds,
    clock,
  });

  const mailer =
    overrides.mailer ??
    createSmtpMailer({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.secure,
      credentials: config.mail.credentials,
      from: config.mail.from,
      onFailure: (reason) => app.log.error({ err: reason }, "email delivery failed"),
    });

  const captcha =
    overrides.captcha ??
    (config.captcha.mode === "google"
      ? createGoogleCaptchaVerifier(config.captcha.secretKey)
      : createTestCaptchaVerifier());

  /**
   * In mock mode every known provider is offered, so the offline flow can be
   * demonstrated for each. In live mode only the ones with credentials are —
   * configuring GitHub alone is a perfectly good setup, and a button that
   * cannot work should not be shown.
   */
  const oauth =
    overrides.oauth ??
    (config.oauth.mode === "live"
      ? createOAuthRegistry(
          config.oauth.credentials.map((credential) =>
            credential.provider === "google"
              ? createGoogleOAuthProvider(credential.clientId, credential.clientSecret)
              : createGitHubOAuthProvider(credential.clientId, credential.clientSecret),
          ),
          false,
        )
      : createOAuthRegistry(
          OAUTH_PROVIDERS.map((provider) =>
            createMockOAuthProvider(provider, config.tokens.secret),
          ),
          true,
        ));

  const storage = createFileMediaStorage({
    directory: config.media.directory,
    maxBytes: config.media.maxBytes,
  });

  const totp = createTotpService(clock);

  /* --------------------------------------------------------------- plugins */

  await app.register(fastifyHelmet, {
    // The API serves JSON and images; the storefront's own CSP is Caddy's job.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Helmet defaults to SAMEORIGIN. Nothing here is meant to be framed at
    // all, and this matches what Caddy sends for the storefront.
    frameguard: { action: "deny" },
  });

  await app.register(fastifyCors, {
    // Same-origin in Docker. This matters only when Vite serves the SPA on
    // another port in development, and credentials require an exact origin —
    // a wildcard would be rejected by the browser.
    origin: [config.http.webOrigin, "http://localhost:5173"],
    credentials: true,
  });

  await app.register(fastifyCookie);

  // The mock OAuth consent screen is a plain HTML <form>, which posts
  // application/x-www-form-urlencoded. Fastify parses JSON and text/plain out
  // of the box and nothing else, so without this the form 422s.
  await app.register(fastifyFormbody);

  await app.register(fastifyRateLimit, {
    global: false,
    max: 300,
    timeWindow: "1 minute",
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: config.media.maxBytes, files: 1, fields: 4 },
  });

  await app.register(fastifyStatic, {
    root: storage.directory,
    // Routing is explicit, so the plugin contributes `sendFile` and nothing else.
    serve: false,
  });

  await app.register(fastifySwagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "Prism API",
        version: "1.0.0",
        description:
          "A B2C storefront that sells colors. Every request schema below is the same Zod schema the browser validates against.",
      },
      tags: [
        { name: "auth", description: "Accounts, sessions, tokens, 2FA" },
        { name: "catalog", description: "Categories, search, colors, images" },
      ],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/api/docs",
    uiConfig: { docExpansion: "list", deepLinking: true },
  });

  /* --------------------------------------------------------------- modules */

  const authRepository = createAuthRepository(database.db);
  const catalogRepository = createCatalogRepository(database.db);

  const guards = createGuards({ tokens, repository: authRepository, clock });

  registerAuthenticatedDecorator(app);

  const authService = createAuthService({
    repository: authRepository,
    clock,
    hasher,
    tokens,
    totp,
    mailer,
    captcha,
    oauth,
    webOrigin: config.http.webOrigin,
    accessTtlSeconds: config.tokens.accessTtlSeconds,
    refreshTtlSeconds: config.tokens.refreshTtlSeconds,
    passwordResetTtlSeconds: config.tokens.passwordResetTtlSeconds,
  });

  const catalogService = createCatalogService({
    repository: catalogRepository,
    storage,
    caches: {
      facets: createTtlCache({
        clock,
        ttlSeconds: config.cache.facetTtlSeconds,
        maxEntries: 200,
      }),
      products: createTtlCache({
        clock,
        ttlSeconds: config.cache.productTtlSeconds,
        maxEntries: 300,
      }),
    },
  });

  await app.register(
    async (scope) => {
      scope.get(
        "/health",
        { schema: { tags: ["catalog"], summary: "Liveness probe." } },
        async () => ({ status: "ok", time: clock.now().toISOString() }),
      );

      // Nested prefix, so every auth path sits under the same `/api/v1/auth`
      // the refresh cookie is scoped to.
      await scope.register(
        async (authScope) => {
          registerAuthRoutes(authScope, {
            service: authService,
            guards,
            cookies: {
              // Marking a cookie Secure over plain http makes the browser drop
              // it silently, so this follows the scheme actually in use.
              secure: config.http.webOrigin.startsWith("https://"),
            },
            mockOAuthSecret:
              config.oauth.mode === "mock"
                ? Option.some(config.tokens.secret)
                : Option.none,
            publicWebOrigin: config.http.webOrigin,
            authRateLimitPerMinute: config.rateLimit.authPerMinute,
          });
        },
        { prefix: "/auth" },
      );

      registerCatalogRoutes(scope, {
        service: catalogService,
        guards,
        publicCacheSeconds: config.cache.facetTtlSeconds,
        maxImageBytes: config.media.maxBytes,
      });
    },
    { prefix: API_PREFIX },
  );

  registerMediaRoutes(app);

  await app.ready();

  return app;
};
