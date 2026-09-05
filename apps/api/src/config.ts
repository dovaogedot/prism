/**
 * Every environment variable this service reads, parsed once at boot.
 *
 * A misconfigured container fails immediately with a list of what is wrong,
 * rather than at 3am when the first password reset email tries to send.
 */

import type { OAuthProviderName } from "@prism/shared";
import { Option } from "@prism/shared";
import { z } from "zod";

const durationSeconds = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

/**
 * CAPTCHA and OAuth both default to a mode that needs no external account, so
 * `docker compose up` works for a reviewer who has never seen a Google Cloud
 * console. Set the real credentials and the mode switches itself.
 */
const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),

  /** Where the browser reaches the site. Used for CORS and email links. */
  PUBLIC_WEB_URL: z.url().default("http://localhost:3000"),

  /** 64 hex characters — `openssl rand -hex 32`. */
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters."),
  JWT_ISSUER: z.string().min(1).default("prism"),
  ACCESS_TOKEN_TTL_SECONDS: durationSeconds(15 * 60),
  REFRESH_TOKEN_TTL_SECONDS: durationSeconds(7 * 24 * 60 * 60),
  TWO_FACTOR_CHALLENGE_TTL_SECONDS: durationSeconds(5 * 60),
  PASSWORD_RESET_TTL_SECONDS: durationSeconds(30 * 60),

  SMTP_HOST: z.string().min(1).default("mailpit"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  // Empty means an unauthenticated relay, which is what Mailpit is. A real
  // provider needs both, and almost always TLS on 465 or STARTTLS on 587.
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  SMTP_SECURE: z.stringbool().default(false),
  MAIL_FROM: z.string().min(1).default("Prism <noreply@prism.test>"),

  /**
   * `test` accepts Google's official always-pass test token without a network
   * call. `google` verifies against siteverify for real.
   */
  CAPTCHA_MODE: z.enum(["test", "google"]).default("test"),
  RECAPTCHA_SECRET_KEY: z.string().default(""),

  /**
   * `mock` completes the OAuth dance locally for every provider; `live` talks
   * to the real ones. In `live` mode a provider is offered only if its
   * credentials are present, so configuring GitHub alone is a valid setup.
   */
  OAUTH_MODE: z.enum(["mock", "live"]).default("mock"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GITHUB_CLIENT_ID: z.string().default(""),
  GITHUB_CLIENT_SECRET: z.string().default(""),

  /**
   * Sign-in attempts allowed per minute per client address. Configurable
   * because the integration tests need it out of the way, and the tests that
   * exercise throttling itself need it low.
   */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  MEDIA_DIR: z.string().min(1).default("/srv/media"),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),

  FACET_CACHE_TTL_SECONDS: durationSeconds(60),
  PRODUCT_CACHE_TTL_SECONDS: durationSeconds(60),
});

/** The environment as it arrived, once parsed. */
export type Environment = z.infer<typeof environmentSchema>;

/** The environment as the application reads it, grouped by what uses it. */
export type Config = Readonly<{
  environment: Environment["NODE_ENV"];
  isProduction: boolean;
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
    credentials: Option<Readonly<{ user: string; password: string }>>;
    from: string;
  }>;
  captcha:
    | Readonly<{ mode: "test" }>
    | Readonly<{ mode: "google"; secretKey: string }>;
  oauth:
    | Readonly<{ mode: "mock" }>
    | Readonly<{ mode: "live"; credentials: readonly OAuthCredential[] }>;
  rateLimit: Readonly<{ authPerMinute: number }>;
  media: Readonly<{ directory: string; maxBytes: number }>;
  cache: Readonly<{
    facetTtlSeconds: number;
    productTtlSeconds: number;
  }>;
}>;

/**
 * Modes become tagged unions here, so `config.oauth.clientId` simply does not
 * exist unless the mode is `google`. No optional secrets floating around.
 */
const toCaptchaConfig = (environment: Environment): Config["captcha"] =>
  environment.CAPTCHA_MODE === "google"
    ? { mode: "google", secretKey: environment.RECAPTCHA_SECRET_KEY }
    : { mode: "test" };

/** One provider's client pair. */
export type OAuthCredential = Readonly<{
  provider: OAuthProviderName;
  clientId: string;
  clientSecret: string;
}>;

/** A provider counts as configured only when both halves of the pair are set. */
const configuredCredentials = (
  environment: Environment,
): readonly OAuthCredential[] =>
  (
    [
      {
        provider: "google",
        clientId: environment.GOOGLE_CLIENT_ID,
        clientSecret: environment.GOOGLE_CLIENT_SECRET,
      },
      {
        provider: "github",
        clientId: environment.GITHUB_CLIENT_ID,
        clientSecret: environment.GITHUB_CLIENT_SECRET,
      },
    ] as const satisfies readonly OAuthCredential[]
  ).filter(
    (credential) =>
      credential.clientId.length > 0 && credential.clientSecret.length > 0,
  );

const toOAuthConfig = (environment: Environment): Config["oauth"] =>
  environment.OAUTH_MODE === "live"
    ? { mode: "live", credentials: configuredCredentials(environment) }
    : { mode: "mock" };

/** A parsed environment as the shape the application asks questions of. */
export const toConfig = (environment: Environment): Config => ({
  environment: environment.NODE_ENV,
  isProduction: environment.NODE_ENV === "production",
  logLevel: environment.LOG_LEVEL,
  http: {
    host: environment.HOST,
    port: environment.PORT,
    webOrigin: environment.PUBLIC_WEB_URL.replace(/\/$/, ""),
  },
  database: {
    url: environment.DATABASE_URL,
    poolSize: environment.DATABASE_POOL_SIZE,
  },
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
    credentials:
      environment.SMTP_USER.length > 0 && environment.SMTP_PASSWORD.length > 0
        ? Option.some({
            user: environment.SMTP_USER,
            password: environment.SMTP_PASSWORD,
          })
        : Option.none,
    from: environment.MAIL_FROM,
  },
  captcha: toCaptchaConfig(environment),
  oauth: toOAuthConfig(environment),
  rateLimit: { authPerMinute: environment.AUTH_RATE_LIMIT_PER_MINUTE },
  media: {
    directory: environment.MEDIA_DIR,
    maxBytes: environment.MEDIA_MAX_BYTES,
  },
  cache: {
    facetTtlSeconds: environment.FACET_CACHE_TTL_SECONDS,
    productTtlSeconds: environment.PRODUCT_CACHE_TTL_SECONDS,
  },
});

const describeFailure = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

/**
 * Boot-time configuration is not a domain error — there is no caller who could
 * recover from it — so this exits rather than returning a `Result`.
 */
export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = environmentSchema.safeParse(source);

  if (!parsed.success) {
    process.stderr.write(
      `Invalid environment configuration:\n${describeFailure(parsed.error)}\n`,
    );
    process.exit(1);
  }

  const config = toConfig(parsed.data);

  if (config.captcha.mode === "google" && config.captcha.secretKey.length === 0) {
    process.stderr.write("CAPTCHA_MODE=google requires RECAPTCHA_SECRET_KEY.\n");
    process.exit(1);
  }

  if (config.oauth.mode === "live" && config.oauth.credentials.length === 0) {
    process.stderr.write(
      "OAUTH_MODE=live requires at least one provider's credentials: " +
        "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET or GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET.\n",
    );
    process.exit(1);
  }

  return config;
};
