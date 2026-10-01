/**
 * Every environment variable the service reads, parsed once at boot. A
 * misconfigured container fails at once with a list of what is wrong.
 */

import type { OAuthProvider } from "@prism/shared";
import { z } from "zod";

/** One provider's client pair. */
export type OAuthCredential = Readonly<{
  provider: OAuthProvider;
  clientId: string;
  clientSecret: string;
}>;

/** The environment as it arrived, once parsed. */
export type Environment = z.infer<typeof Environment.schema>;
export const Environment = {
  schema: z
    .object({
      LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
      HOST: z.string().min(1).default("0.0.0.0"),
      PORT: z.coerce.number().int().min(1).max(65535).default(8080),
      DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
      DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
      /** Where the browser reaches the site. Used for CORS and email links. */
      PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),
      JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters."),
      JWT_ISSUER: z.string().min(1).default("prism"),
      ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(15 * 60),
      REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(7 * 24 * 60 * 60),
      TWO_FACTOR_CHALLENGE_TTL_SECONDS: z.coerce.number().int().positive().default(5 * 60),
      PASSWORD_RESET_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 60),
      SMTP_HOST: z.string().min(1).default("mailpit"),
      SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
      SMTP_USER: z.string().default(""),
      SMTP_PASSWORD: z.string().default(""),
      SMTP_SECURE: z.stringbool().default(false),
      MAIL_FROM: z.string().min(1).default("Prism <noreply@prism.test>"),
      RECAPTCHA_SECRET_KEY: z.string().default(""),
      OAUTH_GOOGLE_CLIENT_ID: z.string().default(""),
      OAUTH_GOOGLE_CLIENT_SECRET: z.string().default(""),
      OAUTH_GITHUB_CLIENT_ID: z.string().default(""),
      OAUTH_GITHUB_CLIENT_SECRET: z.string().default(""),
      /** Sign-in attempts allowed per minute per client address. */
      AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
      /** Orders placed and addresses checked per minute per client address. */
      CHECKOUT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
      MEDIA_DIR: z.string().min(1).default("/srv/media"),
      /** The AES-256 key of the encrypted columns, as 64 hex characters. */
      DATA_ENCRYPTION_KEY: z
        .string()
        .regex(/^[0-9a-fA-F]{64}$/, "DATA_ENCRYPTION_KEY must be 64 hex characters."),
      RABBITMQ_URL: z.string().min(1, "RABBITMQ_URL is required."),
      STRIPE_SECRET_KEY: z.string().default(""),
      STRIPE_PUBLISHABLE_KEY: z.string().default(""),
      /** Wins over the file below when both are set. */
      STRIPE_WEBHOOK_SECRET: z.string().default(""),
      /** Read on each webhook, so a listener that restarts with a new secret needs no API restart. */
      STRIPE_WEBHOOK_SECRET_FILE: z.string().default(""),
      STRIPE_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
      /** A Nominatim server. Empty checks the address format only. */
      ADDRESS_LOOKUP_URL: z.union([z.literal(""), z.url()]).default("https://nominatim.openstreetmap.org"),
      GUEST_CART_TTL_SECONDS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),
      /** How long a placed order waits for its payment before it expires. */
      PAYMENT_WINDOW_SECONDS: z.coerce.number().int().positive().default(30 * 60),
      /** The pause between simulated fulfillment steps. 0 turns the steps off. */
      FULFILLMENT_STEP_SECONDS: z.coerce.number().int().min(0).default(600),
    })
    .refine(
      (environment) =>
        environment.STRIPE_SECRET_KEY.length === 0 ||
        environment.STRIPE_PUBLISHABLE_KEY.length === 0 ||
        environment.STRIPE_WEBHOOK_SECRET.length > 0 ||
        environment.STRIPE_WEBHOOK_SECRET_FILE.length > 0,
      {
        message: "With both Stripe keys set, set STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_FILE too.",
        path: ["STRIPE_WEBHOOK_SECRET"],
      },
    ),
} as const;

/** Where the signing secret of Stripe's webhooks comes from. */
export type WebhookSecretSource =
  | Readonly<{ from: "value"; value: string }>
  | Readonly<{ from: "file"; path: string }>;

/** Stripe's keys, when both halves are set. */
export type StripeSettings = Readonly<{
  secretKey: string;
  publishableKey: string;
  webhookSecret: WebhookSecretSource;
  timeoutMs: number;
}>;

/** The environment as the application reads it, grouped by what uses it. */
export type Config = Readonly<{
  logLevel: Environment["LOG_LEVEL"];
  http: Readonly<{ host: string; port: number; webOrigin: string }>;
  database: Readonly<{ url: string; poolSize: number }>;
  tokens: Readonly<{
    secret: Uint8Array;
    issuer: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    twoFactorChallengeTtlSeconds: number;
    passwordResetTtlSeconds: number;
  }>;
  mail: Readonly<{
    host: string;
    port: number;
    secure: boolean;
    /** Left out for a relay that needs no login, such as Mailpit. */
    credentials?: Readonly<{ user: string; password: string }>;
    from: string;
  }>;
  /** Supplying a secret key is what turns the real check on. */
  captcha: Readonly<{ mode: "test" }> | Readonly<{ mode: "google"; secretKey: string }>;
  /** Live when at least one provider has both halves of its pair. */
  oauth: Readonly<{ mode: "mock" }> | Readonly<{ mode: "live"; credentials: readonly OAuthCredential[] }>;
  rateLimit: Readonly<{ authPerMinute: number; checkoutPerMinute: number }>;
  media: Readonly<{ directory: string }>;
  /** The 32-byte key of the encrypted columns. */
  encryptionKey: Buffer;
  queue: Readonly<{ url: string }>;
  /** On when both Stripe keys and a webhook secret source are set. */
  payments: Readonly<{ mode: "unavailable" }> | (Readonly<{ mode: "stripe" }> & StripeSettings);
  addressLookup: Readonly<{ mode: "format" }> | Readonly<{ mode: "nominatim"; baseUrl: string; userAgent: string }>;
  commerce: Readonly<{
    guestCartTtlSeconds: number;
    paymentWindowSeconds: number;
    /** Left out when the simulated fulfillment is off. */
    fulfillmentStepSeconds?: number;
  }>;
}>;

export const Config = {
  /** A parsed environment as the shape the application asks questions of. */
  fromEnvironment: (environment: Environment): Config => {
    const pairs: readonly OAuthCredential[] = [
      { provider: "google", clientId: environment.OAUTH_GOOGLE_CLIENT_ID, clientSecret: environment.OAUTH_GOOGLE_CLIENT_SECRET },
      { provider: "github", clientId: environment.OAUTH_GITHUB_CLIENT_ID, clientSecret: environment.OAUTH_GITHUB_CLIENT_SECRET },
    ];
    // A provider counts as configured only when both halves of its pair are set.
    const credentials = pairs.filter(
      (credential) => credential.clientId.length > 0 && credential.clientSecret.length > 0,
    );

    const hasSmtpLogin = environment.SMTP_USER.length > 0 && environment.SMTP_PASSWORD.length > 0;
    const webOrigin = environment.PUBLIC_WEB_URL.replace(/\/$/, "");

    return {
      logLevel: environment.LOG_LEVEL,
      http: {
        host: environment.HOST,
        port: environment.PORT,
        webOrigin,
      },
      database: { url: environment.DATABASE_URL, poolSize: environment.DATABASE_POOL_SIZE },
      tokens: {
        secret: new TextEncoder().encode(environment.JWT_SECRET),
        issuer: environment.JWT_ISSUER,
        accessTtlSeconds: environment.ACCESS_TOKEN_TTL_SECONDS,
        refreshTtlSeconds: environment.REFRESH_TOKEN_TTL_SECONDS,
        twoFactorChallengeTtlSeconds: environment.TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        passwordResetTtlSeconds: environment.PASSWORD_RESET_TTL_SECONDS,
      },
      mail: {
        host: environment.SMTP_HOST,
        port: environment.SMTP_PORT,
        secure: environment.SMTP_SECURE,
        ...(hasSmtpLogin
          ? { credentials: { user: environment.SMTP_USER, password: environment.SMTP_PASSWORD } }
          : {}),
        from: environment.MAIL_FROM,
      },
      captcha:
        environment.RECAPTCHA_SECRET_KEY.length > 0
          ? { mode: "google", secretKey: environment.RECAPTCHA_SECRET_KEY }
          : { mode: "test" },
      oauth: credentials.length > 0 ? { mode: "live", credentials } : { mode: "mock" },
      rateLimit: {
        authPerMinute: environment.AUTH_RATE_LIMIT_PER_MINUTE,
        checkoutPerMinute: environment.CHECKOUT_RATE_LIMIT_PER_MINUTE,
      },
      media: { directory: environment.MEDIA_DIR },
      encryptionKey: Buffer.from(environment.DATA_ENCRYPTION_KEY, "hex"),
      queue: { url: environment.RABBITMQ_URL },
      payments: Config.paymentsOf(environment),
      addressLookup:
        environment.ADDRESS_LOOKUP_URL.length > 0
          ? {
              mode: "nominatim",
              baseUrl: environment.ADDRESS_LOOKUP_URL.replace(/\/$/, ""),
              // Nominatim's usage policy asks every client to identify itself.
              userAgent: `Prism shop (${webOrigin})`,
            }
          : { mode: "format" },
      commerce: {
        guestCartTtlSeconds: environment.GUEST_CART_TTL_SECONDS,
        paymentWindowSeconds: environment.PAYMENT_WINDOW_SECONDS,
        ...(environment.FULFILLMENT_STEP_SECONDS > 0
          ? { fulfillmentStepSeconds: environment.FULFILLMENT_STEP_SECONDS }
          : {}),
      },
    };
  },

  /**
   * Payments are on when both Stripe keys are set; half a pair counts as none.
   * The schema refuses a pair without a webhook secret source.
   */
  paymentsOf: (environment: Environment): Config["payments"] => {
    if (environment.STRIPE_SECRET_KEY.length === 0 || environment.STRIPE_PUBLISHABLE_KEY.length === 0) {
      return { mode: "unavailable" };
    }

    return {
      mode: "stripe",
      secretKey: environment.STRIPE_SECRET_KEY,
      publishableKey: environment.STRIPE_PUBLISHABLE_KEY,
      webhookSecret:
        environment.STRIPE_WEBHOOK_SECRET.length > 0
          ? { from: "value", value: environment.STRIPE_WEBHOOK_SECRET }
          : { from: "file", path: environment.STRIPE_WEBHOOK_SECRET_FILE },
      timeoutMs: environment.STRIPE_TIMEOUT_MS,
    };
  },

  /** Boot-time configuration has no caller who could recover, so this exits on failure. */
  load: (source: NodeJS.ProcessEnv = process.env): Config => {
    const parsed = Environment.schema.safeParse(source);

    if (!parsed.success) {
      const lines = parsed.error.issues.map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`);
      process.stderr.write(`Invalid environment configuration:\n${lines.join("\n")}\n`);
      process.exit(1);
    }

    return Config.fromEnvironment(parsed.data);
  },
} as const;
