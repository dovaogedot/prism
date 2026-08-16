/**
 * One schema per request shape, used three times: Fastify validates with it,
 * the OpenAPI document is generated from it, and react-hook-form checks the
 * same rules in the browser. "Validation on both client and server" without
 * two definitions that can drift apart.
 */

import { z } from "zod";

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * NIST SP 800-63B: length and a breach check beat composition rules, which
 * mostly teach people to write `Password1!`. A denylist stands in for the
 * breach corpus at this scale.
 */
const COMMON_PASSWORDS: ReadonlySet<string> = new Set([
  "password123",
  "123456789012",
  "qwertyuiop12",
  "iloveshopping",
  "letmeinplease",
  "administrator",
]);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(EMAIL_MAX_LENGTH));

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine(
    (password) => !COMMON_PASSWORDS.has(password.toLowerCase()),
    "That password is too easy to guess.",
  );

export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  captchaToken: z.string().min(1, "Complete the CAPTCHA to continue."),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: totpCodeSchema,
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

export const enableTwoFactorSchema = z.object({
  code: totpCodeSchema,
});

export const disableTwoFactorSchema = z.object({
  code: totpCodeSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;

export const USER_ROLES = ["customer", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Every third-party sign-in this platform speaks. Adding one means adding it
 * here, writing an adapter, and nothing else — the routes, the mock provider
 * and the sign-in buttons are all driven off this list.
 */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

export const OAUTH_PROVIDER_LABELS: Record<OAuthProviderName, string> = {
  google: "Google",
  github: "GitHub",
};

/** What `GET /auth/oauth/providers` answers, so the UI shows only live buttons. */
export type AvailableProviders = Readonly<{
  providers: readonly OAuthProviderName[];
  /** True when the built-in offline stand-in is answering instead of the real thing. */
  mock: boolean;
}>;

export type SessionUser = Readonly<{
  id: string;
  email: string;
  role: UserRole;
  twoFactorEnabled: boolean;
  /** Whether a password is set — OAuth-only accounts cannot use password login. */
  hasPassword: boolean;
  /**
   * Linked OAuth providers, alphabetically. An account can have several: two
   * providers reporting the same verified address land on the same user.
   */
  providers: readonly string[];
}>;

/**
 * The access token never touches storage. It lives in a module variable in the
 * SPA and dies with the tab; the refresh cookie is what survives a reload.
 */
export type AccessGrant = Readonly<{
  accessToken: string;
  expiresInSeconds: number;
  user: SessionUser;
}>;

/**
 * Sign-in is not one outcome but two, so it is a tagged union rather than a
 * response with half its fields optional.
 */
export type LoginOutcome =
  | Readonly<{ status: "authenticated"; grant: AccessGrant }>
  | Readonly<{ status: "two_factor_required"; challengeToken: string }>;

export type TwoFactorSetup = Readonly<{
  /** `otpauth://` URI for manual entry. */
  uri: string;
  /** The same URI as an inline SVG QR code, ready to render. */
  qrCodeSvg: string;
}>;
