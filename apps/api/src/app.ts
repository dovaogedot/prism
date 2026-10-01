/**
 * The composition root: the only file that knows which adapter implements
 * which port. Tests build the same application with a fake clock, a memory
 * mailer, a memory queue and a fake payment gateway.
 */

import { mkdir } from "node:fs/promises";
import fastifyCookie from "@fastify/cookie";
import fastifyCors from "@fastify/cors";
import fastifyFormbody from "@fastify/formbody";
import fastifyHelmet from "@fastify/helmet";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { OAuthProvider, type PaymentsConfig } from "@prism/shared";
import Fastify, { type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { HttpErrors } from "./http/errors.ts";
import { Guards } from "./http/guard.ts";
import { Housekeeping } from "./jobs/housekeeping.ts";
import { OrderCanceled, PaymentStatusChanged } from "./messaging/messages.ts";
import { OutboxRelay } from "./messaging/outbox.ts";
import { Topology } from "./messaging/topology.ts";
import { AuthRepository } from "./modules/auth/repository.ts";
import { AuthRoutes } from "./modules/auth/routes.ts";
import { AuthService } from "./modules/auth/service.ts";
import { CartRepository } from "./modules/cart/repository.ts";
import { CartRoutes } from "./modules/cart/routes.ts";
import { CartService } from "./modules/cart/service.ts";
import { CatalogRepository } from "./modules/catalog/repository.ts";
import { CatalogRoutes } from "./modules/catalog/routes.ts";
import { OrderRepository } from "./modules/orders/repository.ts";
import { OrderRoutes } from "./modules/orders/routes.ts";
import { OrderService } from "./modules/orders/service.ts";
import { PaymentRepository } from "./modules/payments/repository.ts";
import { PaymentRoutes } from "./modules/payments/routes.ts";
import { PaymentService } from "./modules/payments/service.ts";
import { AddressVerifier } from "./platform/address-verifier.ts";
import { CaptchaVerifier } from "./platform/captcha.ts";
import { FieldCipher } from "./platform/cipher.ts";
import { Clock } from "./platform/clock.ts";
import { Hasher } from "./platform/hasher.ts";
import { Mailer } from "./platform/mailer.ts";
import { IdentityProvider, IdentityProviders } from "./platform/oauth.ts";
import { PaymentGateway } from "./platform/payment-gateway.ts";
import { MessageQueue } from "./platform/queue.ts";
import { TokenService } from "./platform/tokens.ts";
import { TotpService } from "./platform/totp.ts";

/** Tests substitute the pieces that would otherwise reach the outside world. */
export type AppOverrides = Readonly<{
  clock?: Clock;
  hasher?: Hasher;
  mailer?: Mailer;
  captcha?: CaptchaVerifier;
  oauth?: IdentityProviders;
  queue?: MessageQueue;
  /** Turns payments on whatever the configuration says. */
  gateway?: PaymentGateway;
  addressVerifier?: AddressVerifier;
}>;

/** Everything the application is built from. */
export type AppInput = Readonly<{
  config: Config;
  database: DatabaseHandle;
  overrides?: AppOverrides;
}>;

/** The work that runs beside the HTTP server, on timers. */
export type Jobs = Readonly<{
  relay: OutboxRelay;
  housekeeping: Housekeeping;
  /** Starts both timers. Tests leave them off and call `flush` and `run` themselves. */
  start: () => void;
  /** Stops both timers and waits for a pass in progress. */
  stop: () => Promise<void>;
}>;

/** The server and the jobs that run beside it. */
export type Application = Readonly<{ app: FastifyInstance; jobs: Jobs }>;

export const App = {
  PREFIX: "/api/v1",
  /** How often the relay looks for messages a kick did not publish. */
  RELAY_INTERVAL_MS: 2000,
  HOUSEKEEPING_INTERVAL_MS: 30_000,

  /** Builds every adapter and wires the modules onto them. */
  build: async (input: AppInput): Promise<Application> => {
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
    const cookies = { secure: config.http.webOrigin.startsWith("https://") };

    const cipher = FieldCipher.create(config.encryptionKey);

    const queue =
      overrides.queue ??
      MessageQueue.rabbitmq({
        url: config.queue.url,
        topology: Topology.declarations(),
        onFailure: (context, reason) => app.log.error({ err: reason }, context),
      });
    app.addHook("onClose", () => queue.close());

    const gateway =
      overrides.gateway ?? (config.payments.mode === "stripe" ? PaymentGateway.stripe(config.payments) : undefined);

    const paymentsConfig: PaymentsConfig =
      config.payments.mode === "stripe"
        ? { provider: "stripe", publishableKey: config.payments.publishableKey }
        : { provider: "unavailable" };

    const addressVerifier =
      overrides.addressVerifier ??
      (config.addressLookup.mode === "nominatim"
        ? AddressVerifier.nominatim(config.addressLookup.baseUrl, config.addressLookup.userAgent)
        : AddressVerifier.formatOnly());

    const relay = OutboxRelay.create({
      db: database.db,
      queue,
      onFailure: (reason) => app.log.error({ err: reason }, "the outbox relay could not publish"),
    });

    const cartRepository = CartRepository.create(database.db);
    const cartService = CartService.create({
      repository: cartRepository,
      catalog: catalogRepository,
      clock,
      guestCartTtlSeconds: config.commerce.guestCartTtlSeconds,
    });

    const paymentService = PaymentService.create({
      repository: PaymentRepository.create(database.db, cipher),
      ...(gateway === undefined ? {} : { gateway }),
      clock,
      kick: relay.kick,
      onAnomaly: (message, detail) => app.log.warn(detail, message),
    });

    const orderService = OrderService.create({
      repository: OrderRepository.create(database.db, cipher),
      carts: cartRepository,
      users: authRepository,
      payments: paymentService,
      paymentsAvailable: gateway !== undefined,
      verifier: addressVerifier,
      mailer,
      clock,
      kick: relay.kick,
      webOrigin: config.http.webOrigin,
      paymentWindowSeconds: config.commerce.paymentWindowSeconds,
      ...(config.commerce.fulfillmentStepSeconds === undefined
        ? {}
        : { fulfillmentStepSeconds: config.commerce.fulfillmentStepSeconds }),
    });

    await queue.consume(Topology.PAYMENT_STATUS_QUEUE, PaymentStatusChanged.schema, orderService.onPaymentStatus);
    await queue.consume(Topology.ORDER_CANCELED_QUEUE, OrderCanceled.schema, paymentService.onOrderCanceled);

    const housekeeping = Housekeeping.create({
      orders: orderService,
      carts: cartRepository,
      clock,
      onFailure: (reason) => app.log.error({ err: reason }, "housekeeping failed"),
    });

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
              cookies,
              ...(config.oauth.mode === "mock" ? { mockOAuthSecret: config.tokens.secret } : {}),
              publicWebOrigin: config.http.webOrigin,
              authRateLimitPerMinute: config.rateLimit.authPerMinute,
            });
          },
          { prefix: "/auth" },
        );

        CatalogRoutes.register(scope, { repository: catalogRepository });
        CartRoutes.register(scope, { service: cartService, guards, cookies });
        OrderRoutes.register(scope, {
          service: orderService,
          carts: cartService,
          guards,
          cookies,
          payments: paymentsConfig,
          checkoutRateLimitPerMinute: config.rateLimit.checkoutPerMinute,
        });
        await PaymentRoutes.register(scope, { service: paymentService });
      },
      { prefix: App.PREFIX },
    );

    await app.ready();

    return {
      app,
      jobs: {
        relay,
        housekeeping,
        start: () => {
          relay.start(App.RELAY_INTERVAL_MS);
          housekeeping.start(App.HOUSEKEEPING_INTERVAL_MS);
        },
        stop: async () => {
          await housekeeping.stop();
          await relay.stop();
        },
      },
    };
  },
} as const;
