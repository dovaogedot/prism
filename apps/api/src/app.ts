/**
 * The composition root: the only file that knows which adapter implements
 * which port. Tests build the same application with a fake clock and a
 * memory mailer.
 */

import { mkdir } from "node:fs/promises";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { OAuthProvider } from "@prism/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { HttpErrors } from "./http/errors.ts";
import { Guards } from "./http/guard.ts";
import { AuthRepository } from "./modules/auth/repository.ts";
import { AuthRoutes } from "./modules/auth/routes.ts";
import { AuthService } from "./modules/auth/service.ts";
import { CatalogRepository } from "./modules/catalog/repository.ts";
import { CatalogRoutes } from "./modules/catalog/routes.ts";
import { CaptchaVerifier } from "./platform/captcha.ts";
import { Clock } from "./platform/clock.ts";
import { Hasher } from "./platform/hasher.ts";
import { Mailer } from "./platform/mailer.ts";
import { IdentityProvider, IdentityProviders } from "./platform/oauth.ts";
import { TokenService } from "./platform/tokens.ts";
import { TotpService } from "./platform/totp.ts";

/** Tests substitute the pieces that would otherwise reach the outside world. */
export type AppOverrides = Readonly<{
  clock?: Clock;
  hasher?: Hasher;
  mailer?: Mailer;
  captcha?: CaptchaVerifier;
  oauth?: IdentityProviders;
}>;

/** Everything the application is built from. */
export type AppInput = Readonly<{
  config: Config;
  database: DatabaseHandle;
  overrides?: AppOverrides;
}>;

export const App = {
  PREFIX: "/api/v1",

  /** Builds every adapter and wires the modules onto them. */
  build: async (input: AppInput): Promise<FastifyInstance> => {
    const { config, database } = input;
    const overrides = input.overrides ?? {};

    const app = Fastify({
      logger: { level: config.logLevel },
      // Caddy terminates the connection. Trusting the private ranges, rather
      // than the whole X-Forwarded-For chain, takes the first address no proxy
      // on this network vouched for, whatever the caller put in the header.
      trustProxy: "loopback, linklocal, uniquelocal",
      bodyLimit: 256 * 1024,
    });

    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    HttpErrors.register(app);

    const clock = overrides.clock ?? Clock.system;
    const hasher = overrides.hasher ?? Hasher.argon2();
    const tokens = TokenService.create({ ...config.tokens, clock });
    const totp = TotpService.create(clock);

    const mailer =
      overrides.mailer ??
      Mailer.smtp({
        ...config.mail,
        onFailure: (reason) => app.log.error({ err: reason }, "email delivery failed"),
      });

    const captcha =
      overrides.captcha ??
      (config.captcha.mode === "google" ? CaptchaVerifier.google(config.captcha.secretKey) : CaptchaVerifier.test());

    // In mock mode every provider is offered; in live mode only the ones with credentials.
    const oauth =
      overrides.oauth ??
      (config.oauth.mode === "live"
        ? IdentityProviders.of(
            config.oauth.credentials.map((credential) =>
              credential.provider === "google"
                ? IdentityProvider.google(credential.clientId, credential.clientSecret)
                : IdentityProvider.github(credential.clientId, credential.clientSecret),
            ),
            false,
          )
        : IdentityProviders.of(
            OAuthProvider.NAMES.map((name) => IdentityProvider.mock(name, config.tokens.secret)),
            true,
          ));

    await app.register(fastifyHelmet, {
      // The API serves JSON and images; the storefront's CSP is Caddy's job.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      frameguard: { action: "deny" },
    });

    await app.register(fastifyCors, {
      // Same-origin in Docker; the second entry serves `vite dev`.
      origin: [config.http.webOrigin, "http://localhost:5173"],
      credentials: true,
    });

    await app.register(fastifyCookie);
    // The mock consent screen is a plain HTML form, which posts urlencoded.
    await app.register(fastifyFormbody);
    await app.register(fastifyRateLimit, { global: false, max: 300, timeWindow: "1 minute" });

    await mkdir(config.media.directory, { recursive: true });
    await app.register(fastifyStatic, {
      root: config.media.directory,
      prefix: "/media/",
      index: false,
      decorateReply: false,
      maxAge: "1d",
    });

    const authRepository = AuthRepository.create(database.db);
    const guards = Guards.create({ tokens, repository: authRepository, clock });
    Guards.decorate(app);

    const authService = AuthService.create({
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

    const catalogRepository = CatalogRepository.create(database.db);

    await app.register(
      async (scope) => {
        scope.get("/health", async () => ({ status: "ok", time: clock.now().toISOString() }));

        // Nested prefix, so every auth path sits under the path the refresh cookie is scoped to.
        await scope.register(
          async (authScope) => {
            AuthRoutes.register(authScope, {
              service: authService,
              guards,
              // A Secure cookie over plain http is dropped silently.
              cookies: { secure: config.http.webOrigin.startsWith("https://") },
              ...(config.oauth.mode === "mock" ? { mockOAuthSecret: config.tokens.secret } : {}),
              publicWebOrigin: config.http.webOrigin,
              authRateLimitPerMinute: config.rateLimit.authPerMinute,
            });
          },
          { prefix: "/auth" },
        );

        CatalogRoutes.register(scope, { repository: catalogRepository });
      },
      { prefix: App.PREFIX },
    );

    await app.ready();

    return app;
  },
} as const;
