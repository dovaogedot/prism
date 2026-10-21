/**
 * Every environment variable the service reads, parsed once at boot. A
 * misconfigured container fails at once with a list of what is wrong.
 */

import { Email, Password, type OAuthProvider } from "@prism/shared";
import { z } from "zod";
import { EncryptionKey } from "./platform/cipher.ts";
import { TotpSecret } from "./platform/totp.ts";

/** An address that may or may not be this machine's. */
export const LocalUrl = {
  /** Whether `url` names this machine. */
  isLocal: (url: string): boolean => {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  },
} as const;

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
      /** Where the contact form's messages go. */
      SUPPORT_EMAIL: Email.schema.default(Email.schema.parse("support@prism.test")),
      RECAPTCHA_SECRET_KEY: z.string().default(""),
      OAUTH_GOOGLE_CLIENT_ID: z.string().default(""),
      OAUTH_GOOGLE_CLIENT_SECRET: z.string().default(""),
      OAUTH_GITHUB_CLIENT_ID: z.string().default(""),
      OAUTH_GITHUB_CLIENT_SECRET: z.string().default(""),
      /** Multiplies every rate limit's capacity and refill rate; 1 outside tests and load tests. */
      RATE_LIMIT_SCALE: z.coerce.number().positive().default(1),
      MEDIA_DIR: z.string().min(1).default("/srv/media"),
      /** The AES-256 key of the encrypted columns, as 64 hex characters. */
      DATA_ENCRYPTION_KEY: EncryptionKey.schema,
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
      /**
       * `stripe` takes real test or live payments once both keys are set.
       * `simulated` settles every payment on the server, for test and
       * load-test stacks on a laptop.
       */
      PAYMENTS_MODE: z.enum(["stripe", "simulated"]).default("stripe"),
      /** The first admin's sign-in. The three are set together or not at all; empty counts as unset. */
      ADMIN_EMAIL: z.preprocess((value) => (value === "" ? undefined : value), Email.schema.optional()),
      ADMIN_PASSWORD: z.preprocess((value) => (value === "" ? undefined : value), Password.schema.optional()),
      /** The first admin's 2FA key: base32 of at least 32 characters, 160 bits. */
      ADMIN_TOTP_SECRET: z.preprocess((value) => (value === "" ? undefined : value), TotpSecret.base32.optional()),
      /** How long a session's TOTP check opens the admin. */
      STAFF_VERIFICATION_TTL_SECONDS: z.coerce.number().int().positive().default(8 * 60 * 60),
    })
    .refine(
      (environment) => {
        const set = [environment.ADMIN_EMAIL, environment.ADMIN_PASSWORD, environment.ADMIN_TOTP_SECRET].filter(
          (value) => value !== undefined,
        ).length;
        return set === 0 || set === 3;
      },
      { message: "Set ADMIN_EMAIL, ADMIN_PASSWORD and ADMIN_TOTP_SECRET together, or none of them.", path: ["ADMIN_EMAIL"] },
    )
    .refine((environment) => environment.PAYMENTS_MODE !== "simulated" || LocalUrl.isLocal(environment.PUBLIC_WEB_URL), {
      message: "PAYMENTS_MODE=simulated takes no money, so it runs only where PUBLIC_WEB_URL is on localhost.",
      path: ["PAYMENTS_MODE"],
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

/** The account made the shop's admin when it has none. */
export type FirstAdminSettings = Readonly<{ email: Email; password: string; totpSecret: TotpSecret }>;

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
    /** The inbox the contact form writes to. */
    support: Email;
  }>;
  /** Supplying a secret key is what turns the real check on. */
  captcha: Readonly<{ mode: "test" }> | Readonly<{ mode: "google"; secretKey: string }>;
  /** Live when at least one provider has both halves of its pair. */
  oauth: Readonly<{ mode: "mock" }> | Readonly<{ mode: "live"; credentials: readonly OAuthCredential[] }>;
  rateLimit: Readonly<{ scale: number }>;
  media: Readonly<{ directory: string }>;
  /** The 32-byte key of the encrypted columns. */
  encryptionKey: Buffer;
  queue: Readonly<{ url: string }>;
  /** Stripe when both keys and a webhook secret source are set; simulated only on localhost. */
  payments:
    | Readonly<{ mode: "unavailable" }>
    | Readonly<{ mode: "simulated" }>
    | (Readonly<{ mode: "stripe" }> & StripeSettings);
  addressLookup: Readonly<{ mode: "format" }> | Readonly<{ mode: "nominatim"; baseUrl: string; userAgent: string }>;
  commerce: Readonly<{
    guestCartTtlSeconds: number;
    paymentWindowSeconds: number;
  }>;
  /** Left out when the environment names no first admin. */
  firstAdmin?: FirstAdminSettings;
  staff: Readonly<{ verificationTtlSeconds: number }>;
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
        support: environment.SUPPORT_EMAIL,
      },
      captcha:
        environment.RECAPTCHA_SECRET_KEY.length > 0
          ? { mode: "google", secretKey: environment.RECAPTCHA_SECRET_KEY }
          : { mode: "test" },
      oauth: credentials.length > 0 ? { mode: "live", credentials } : { mode: "mock" },
      rateLimit: { scale: environment.RATE_LIMIT_SCALE },
      media: { directory: environment.MEDIA_DIR },
      encryptionKey: EncryptionKey.bytes(environment.DATA_ENCRYPTION_KEY),
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
      },
      ...Config.firstAdminOf(environment),
      staff: { verificationTtlSeconds: environment.STAFF_VERIFICATION_TTL_SECONDS },
    };
  },

  /** The first admin, when all three of its variables are set; the schema refuses fewer. */
  firstAdminOf: (environment: Environment): Readonly<{ firstAdmin?: FirstAdminSettings }> =>
    environment.ADMIN_EMAIL === undefined ||
    environment.ADMIN_PASSWORD === undefined ||
    environment.ADMIN_TOTP_SECRET === undefined
      ? {}
      : {
          firstAdmin: {
            email: environment.ADMIN_EMAIL,
            password: environment.ADMIN_PASSWORD,
            totpSecret: environment.ADMIN_TOTP_SECRET,
          },
        },

  /**
   * Payments are on when both Stripe keys are set; half a pair counts as none.
   * The schema refuses a pair without a webhook secret source.
   */
  paymentsOf: (environment: Environment): Config["payments"] => {
    if (environment.PAYMENTS_MODE === "simulated") return { mode: "simulated" };

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
