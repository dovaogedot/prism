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
import fastifyMultipart from "@fastify/multipart";
import { Delivery, OAuthProvider, type PaymentsConfig } from "@prism/shared";
import Fastify, { type FastifyContextConfig, type FastifyInstance } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import type { DatabaseHandle } from "./db/client.ts";
import { HttpErrors } from "./http/errors.ts";
import { CachePolicy } from "./http/cache.ts";
import { Guards } from "./http/guard.ts";
import { RateLimits } from "./http/rate-limits.ts";
import { Housekeeping } from "./jobs/housekeeping.ts";
import { OrderCanceled, OrderRefundRequested, PaymentStatusChanged } from "./messaging/messages.ts";
import { OutboxRelay } from "./messaging/outbox.ts";
import { Topology } from "./messaging/topology.ts";
import { AccountAdminRepository } from "./modules/auth/admin-repository.ts";
import { AccountAdminRoutes } from "./modules/auth/admin-routes.ts";
import { AccountAdminService } from "./modules/auth/admin-service.ts";
import { FirstAdmin } from "./modules/auth/first-admin.ts";
import { AuthRepository } from "./modules/auth/repository.ts";
import { AuthRoutes } from "./modules/auth/routes.ts";
import { AuthService } from "./modules/auth/service.ts";
import { CartRepository } from "./modules/cart/repository.ts";
import { CartRoutes } from "./modules/cart/routes.ts";
import { CartService } from "./modules/cart/service.ts";
import { CatalogAdminRepository } from "./modules/catalog/admin-repository.ts";
import { CatalogAdminRoutes } from "./modules/catalog/admin-routes.ts";
import { CatalogAdminService } from "./modules/catalog/admin-service.ts";
import { CatalogRepository } from "./modules/catalog/repository.ts";
import { CatalogRoutes } from "./modules/catalog/routes.ts";
import { OrderRepository } from "./modules/orders/repository.ts";
import { OrderAdminRoutes } from "./modules/orders/admin-routes.ts";
import { OrderRoutes } from "./modules/orders/routes.ts";
import { OrderService } from "./modules/orders/service.ts";
import { ShippingMethods } from "./modules/orders/shipping.ts";
import { PaymentRepository } from "./modules/payments/repository.ts";
import { PaymentRoutes } from "./modules/payments/routes.ts";
import { PaymentService } from "./modules/payments/service.ts";
import { AccountRepository } from "./modules/accounts/repository.ts";
import { AccountRoutes } from "./modules/accounts/routes.ts";
import { AccountService } from "./modules/accounts/service.ts";
import { SeoRoutes } from "./modules/seo/routes.ts";
import { SupportRoutes } from "./modules/support/routes.ts";
import { SupportService } from "./modules/support/service.ts";
import { ReviewAdminRoutes } from "./modules/reviews/admin-routes.ts";
import { ReviewRepository } from "./modules/reviews/repository.ts";
import { ReviewRoutes } from "./modules/reviews/routes.ts";
import { ReviewService } from "./modules/reviews/service.ts";
import { AuditLog } from "./modules/staff/audit.ts";
import { StaffRoutes } from "./modules/staff/routes.ts";
import type { SummaryCounters } from "./modules/staff/summary.ts";
import { AddressVerifier } from "./platform/address-verifier.ts";
import { CaptchaVerifier } from "./platform/captcha.ts";
import { FieldCipher } from "./platform/cipher.ts";
import { Clock } from "./platform/clock.ts";
import { Hasher } from "./platform/hasher.ts";
import { Mailer } from "./platform/mailer.ts";
import { ImageStore } from "./platform/image-store.ts";
import { IdentityProvider, IdentityProviders } from "./platform/oauth.ts";
import { PaymentGateway } from "./platform/payment-gateway.ts";
import { MessageQueue } from "./platform/queue.ts";
import { RateLimiter } from "./platform/rate-limit.ts";
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

/** One route as mounted, with the options a test walks the routes by. */
export type MountedRoute = Readonly<{ method: string; url: string; config: FastifyContextConfig }>;

/** The server, the jobs that run beside it, and every route it mounted. */
export type Application = Readonly<{ app: FastifyInstance; jobs: Jobs; routes: readonly MountedRoute[] }>;

export const App = {
  PREFIX: "/api/v1",
  /** How often the relay looks for messages a kick did not publish. */
  RELAY_INTERVAL_MS: 2000,
  HOUSEKEEPING_INTERVAL_MS: 30_000,

  /** The provider new charges go through, as the configuration chooses it. */
  gatewayOf: (payments: Config["payments"], simulated: PaymentGateway): PaymentGateway | undefined => {
    if (payments.mode === "stripe") return PaymentGateway.stripe(payments);
    if (payments.mode === "simulated") return simulated;
    return undefined;
  },

  /** What the browser is told about payments. */
  paymentsConfigOf: (payments: Config["payments"]): PaymentsConfig => {
    if (payments.mode === "stripe") return { provider: "stripe", publishableKey: payments.publishableKey };
    if (payments.mode === "simulated") return { provider: "simulated" };
    return { provider: "unavailable" };
  },

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

    const routes: MountedRoute[] = [];
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) {
        routes.push({ method, url: route.url, config: route.config ?? {} });
      }
    });

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
    // Picture uploads and catalog imports. Each route sets its own file size.
    await app.register(fastifyMultipart, { limits: { files: 1, fields: 10, fieldSize: 1024 } });

    // The web container serves the pictures straight from this directory.
    await mkdir(config.media.directory, { recursive: true });
    const images = ImageStore.create(config.media.directory);

    const cipher = FieldCipher.create(config.encryptionKey);
    const audit = AuditLog.create(database.db, cipher);
    const authRepository = AuthRepository.create(database.db, cipher, audit);
    const guards = Guards.create({
      tokens,
      repository: authRepository,
      clock,
      staffVerificationTtlSeconds: config.staff.verificationTtlSeconds,
    });
    Guards.decorate(app);

    CachePolicy.register(app, App.PREFIX);

    const limiter = RateLimiter.create({ clock, scale: config.rateLimit.scale });
    RateLimits.register(app, {
      limiter,
      prefix: App.PREFIX,
      userOf: async (request) => {
        const token = Guards.BEARER.exec(request.headers.authorization ?? "")?.[1];
        if (token === undefined) return undefined;

        const claims = await tokens.verifyAccessToken(token);
        return claims.isOk() ? claims.value.subject : undefined;
      },
    });

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
      staffVerificationTtlSeconds: config.staff.verificationTtlSeconds,
    });

    const accountAdminRepository = AccountAdminRepository.create(database.db, cipher, audit);
    const firstAdmin = await FirstAdmin.ensure({
      repository: accountAdminRepository,
      hasher,
      clock,
      ...(config.firstAdmin === undefined ? {} : { settings: config.firstAdmin }),
    });
    if (firstAdmin !== undefined && firstAdmin._tag !== "Present") app.log.info({ outcome: firstAdmin._tag }, "first admin");

    const catalogRepository = CatalogRepository.create(database.db);
    const cookies = { secure: config.http.webOrigin.startsWith("https://") };

    const queue =
      overrides.queue ??
      MessageQueue.rabbitmq({
        url: config.queue.url,
        topology: Topology.declarations(),
        onFailure: (context, reason) => app.log.error({ err: reason }, context),
      });
    app.addHook("onClose", () => queue.close());

    // Refunds of a simulated payment need the simulated provider whatever the
    // mode, since the seed's orders were paid through it.
    const simulated = PaymentGateway.simulated();
    const gateway = overrides.gateway ?? App.gatewayOf(config.payments, simulated);
    const gateways = { simulated, ...(gateway === undefined ? {} : { [gateway.name]: gateway }) };

    const paymentsConfig = App.paymentsConfigOf(config.payments);

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
      gateways,
      clock,
      kick: relay.kick,
      onAnomaly: (message, detail) => app.log.warn(detail, message),
    });

    const catalogAdminService = CatalogAdminService.create({
      repository: CatalogAdminRepository.create(database.db, audit),
      catalog: catalogRepository,
      images,
      clock,
      onFailure: (reason) => app.log.error({ err: reason }, "a picture's files could not be written or removed"),
    });

    const orderRepository = OrderRepository.create(database.db, cipher, audit);
    const shippingMethods = ShippingMethods.create(database.db, audit, clock);
    const reviewRepository = ReviewRepository.create(database.db, audit);
    const accountRepository = AccountRepository.create(database.db, cipher);
    const accountService = AccountService.create({ repository: accountRepository, users: authRepository, clock });
    const supportService = SupportService.create({ mailer, captcha, inbox: config.mail.support });
    const reviewService = ReviewService.create({
      repository: reviewRepository,
      firstNameOf: async (userId) => (await accountRepository.profileOf(userId))?.fullName?.split(/\s+/)[0],
      clock,
    });

    const accountAdminService = AccountAdminService.create({
      repository: accountAdminRepository,
      recentOrders: async (userId) =>
        (await orderRepository.list(userId, { statuses: [], sort: "newest", page: 1, perPage: 10 })).items,
      mailer,
      clock,
      webOrigin: config.http.webOrigin,
    });

    const counters: SummaryCounters = {
      ordersToFulfill: {
        permission: "orders.fulfill",
        count: () => orderRepository.countInStatus(["payment_successful", "processing"]),
      },
      reviewsWaiting: { permission: "reviews.moderate", count: reviewRepository.countPending },
      lowStockProducts: { permission: "catalog.manage", count: () => catalogRepository.countLowStock(5) },
      paidToday: { permission: "orders.view", count: () => orderRepository.countPaidOn(Delivery.dayOf(clock.now())) },
    };

    const orderService = OrderService.create({
      accounts: {
        profileOf: accountRepository.profileOf,
        defaultAddressOf: accountService.defaultAddressOf,
        addresses: accountRepository.addresses,
        keepAddress: async (userId, input) => {
          await accountService.addAddress(userId, input);
        },
      },
      repository: orderRepository,
      carts: cartRepository,
      users: authRepository,
      payments: paymentService,
      shipping: shippingMethods,
      paymentsAvailable: gateway !== undefined,
      verifier: addressVerifier,
      mailer,
      clock,
      kick: relay.kick,
      webOrigin: config.http.webOrigin,
      paymentWindowSeconds: config.commerce.paymentWindowSeconds,
    });

    await queue.consume(Topology.PAYMENT_STATUS_QUEUE, PaymentStatusChanged.schema, orderService.onPaymentStatus);
    await queue.consume(Topology.ORDER_CANCELED_QUEUE, OrderCanceled.schema, paymentService.onOrderCanceled);
    await queue.consume(Topology.REFUND_REQUESTED_QUEUE, OrderRefundRequested.schema, paymentService.onRefundRequested);

    const housekeeping = Housekeeping.create({
      orders: orderService,
      carts: cartRepository,
      catalog: catalogRepository,
      images,
      clock,
      onFailure: (reason) => app.log.error({ err: reason }, "housekeeping failed"),
    });

    await app.register(
      async (scope) => {
        scope.get("/health", { config: { rateLimit: "none" } }, async () => ({
          status: "ok",
          time: clock.now().toISOString(),
        }));

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
              limitAccount: (email) => limiter.take("account-login", cipher.index("account-email", email).toString("hex")),
            });
          },
          { prefix: "/auth" },
        );

        CatalogRoutes.register(scope, { repository: catalogRepository });
        ReviewRoutes.register(scope, { service: reviewService, guards });
        AccountRoutes.register(scope, { service: accountService, guards });
        SupportRoutes.register(scope, { service: supportService });
        SeoRoutes.register(scope, { db: database.db, webOrigin: config.http.webOrigin });
        CartRoutes.register(scope, { service: cartService, guards, cookies });
        OrderRoutes.register(scope, {
          service: orderService,
          carts: cartService,
          shipping: shippingMethods,
          guards,
          cookies,
          payments: paymentsConfig,
        });
        await PaymentRoutes.register(scope, { service: paymentService });

        await scope.register(
          async (adminScope) => {
            StaffRoutes.register(adminScope, { guards, audit, counters });
            AccountAdminRoutes.register(adminScope, { service: accountAdminService, guards });
            OrderAdminRoutes.register(adminScope, { service: orderService, shipping: shippingMethods, guards });
            CatalogAdminRoutes.register(adminScope, { service: catalogAdminService, guards });
            ReviewAdminRoutes.register(adminScope, { service: reviewService, guards });
          },
          { prefix: "/admin" },
        );
      },
      { prefix: App.PREFIX },
    );

    await app.ready();

    return {
      app,
      routes,
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
