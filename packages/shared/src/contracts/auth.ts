/**
 * One schema per request shape, used three times: Fastify validates with it,
 * the OpenAPI document is generated from it, and react-hook-form checks the
 * same rules in the browser. "Validation on both client and server" without
 * two definitions that can drift apart.
 */

import { z } from "zod";

/** The longest address RFC 5321 allows, which is what the column is sized for. */
export const EMAIL_MAX_LENGTH = 254;
/** The shortest password accepted, in characters. */
export const PASSWORD_MIN_LENGTH = 12;
/** The longest password accepted, in characters. */
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

/** An email address, trimmed and lowercased so equality is string equality. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address.").max(EMAIL_MAX_LENGTH));

/** A password a new account is allowed to have: long enough, and not a guess. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters.`)
  .refine(
    (password) => !COMMON_PASSWORDS.has(password.toLowerCase()),
    "That password is too easy to guess.",
  );

/** A six-digit authenticator code. */
export const totpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app.");

/** The body of `POST /auth/register`. */
export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  captchaToken: z.string().min(1, "Complete the CAPTCHA to continue."),
});

/**
 * The body of `POST /auth/login`.
 *
 * The password is checked for presence only. Sign-in must not tell an attacker
 * that a stored password would have been rejected by the registration rules.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

/**
 * The challenge may arrive in the body or in a short-lived httpOnly cookie.
 *
 * Password sign-in hands the token to the SPA, which carries it in navigation
 * state. The OAuth callback has no SPA to hand it to — it is a redirect — so it
 * leaves the token in a cookie instead of putting it in the URL, where it would
 * land in history and in referrer headers.
 */
export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1).optional(),
  code: totpCodeSchema,
});

/** The body of `POST /auth/forgot-password`. */
export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

/** The body of `POST /auth/reset-password`. */
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: passwordSchema,
});

/**
 * Changing the password from the account page.
 *
 * `currentPassword` is required of an account that has one and meaningless to
 * an account that does not — one created through a provider has nothing to
 * confirm, and the authenticated session is the proof. The server decides
 * which case applies; it does not take the client's word for it.
 */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  password: passwordSchema,
});

/**
 * The confirmation field never leaves the browser — it guards against a typo
 * in a value nobody can read back. Written out per form rather than through a
 * generic wrapper, which erases the shape and makes `values.password` an index
 * lookup.
 */
const confirmField = z.string().min(1, "Repeat the password.");

/** Zod wants a mutable `path`, so this is not `as const`. */
const MISMATCH = {
  message: "The two passwords do not match.",
  path: ["confirmPassword"],
};

const matches = (values: Readonly<{ password: string; confirmPassword: string }>) =>
  values.password === values.confirmPassword;

/** The register form: the request body plus the browser-only confirmation. */
export const registerFormSchema = registerSchema
  .extend({ confirmPassword: confirmField })
  .refine(matches, MISMATCH);

/** The reset form: the request body plus the browser-only confirmation. */
export const resetPasswordFormSchema = resetPasswordSchema
  .extend({ confirmPassword: confirmField })
  .refine(matches, MISMATCH);

/** The change-password form, for an account that has a password to confirm. */
export const changePasswordFormSchema = changePasswordSchema
  .extend({
    currentPassword: z.string().min(1, "Enter your current password."),
    confirmPassword: confirmField,
  })
  .refine(matches, MISMATCH);

/**
 * No current password to confirm: the account signed up through a provider.
 *
 * The field is still in the shape, unvalidated, so both password forms infer
 * the same values type and one component can serve either.
 */
export const setPasswordFormSchema = changePasswordSchema
  .extend({ currentPassword: z.string(), confirmPassword: confirmField })
  .refine(matches, MISMATCH);

/** The body that confirms enrollment by proving the secret was scanned. */
export const enableTwoFactorSchema = z.object({
  code: totpCodeSchema,
});

/** The body that turns two-factor off, which needs a live code like enabling does. */
export const disableTwoFactorSchema = z.object({
  code: totpCodeSchema,
});

/** A validated `POST /auth/register` body. */
export type RegisterInput = z.infer<typeof registerSchema>;
/** A validated `POST /auth/login` body. */
export type LoginInput = z.infer<typeof loginSchema>;
/** A validated second-factor body. */
export type TwoFactorLoginInput = z.infer<typeof twoFactorLoginSchema>;
/** A validated `POST /auth/forgot-password` body. */
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
/** A validated `POST /auth/reset-password` body. */
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
/** A validated change-password body. */
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
/** A validated enable-two-factor body. */
export type EnableTwoFactorInput = z.infer<typeof enableTwoFactorSchema>;
/** A validated disable-two-factor body. */
export type DisableTwoFactorInput = z.infer<typeof disableTwoFactorSchema>;

/** Every role an account can hold. */
export const USER_ROLES = ["customer", "admin"] as const;
/** What an account is allowed to reach. */
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Every third-party sign-in this platform speaks. Adding one means adding it
 * here, writing an adapter, and nothing else — the routes, the mock provider
 * and the sign-in buttons are all driven off this list.
 */
export const OAUTH_PROVIDERS = ["google", "github"] as const;
/** One third-party sign-in, named the way its routes and columns name it. */
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

/** A provider name arriving from a client, which may be anything at all. */
export const oauthProviderSchema = z.enum(OAUTH_PROVIDERS);

/** How each provider spells its own name on a button. */
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

/** Who is signed in, as every authenticated response reports it. */
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

/** Named on its own because the OAuth flow returns this variant and no other. */
export type TwoFactorChallenge = Readonly<{
  status: "two_factor_required";
  challengeToken: string;
}>;

/**
 * Sign-in is not one outcome but two, so it is a tagged union rather than a
 * response with half its fields optional.
 */
export type LoginOutcome =
  | Readonly<{ status: "authenticated"; grant: AccessGrant }>
  | TwoFactorChallenge;

/** The secret being enrolled, in the two forms an authenticator app accepts. */
export type TwoFactorSetup = Readonly<{
  /** `otpauth://` URI for manual entry. */
  uri: string;
  /** The same URI as an inline SVG QR code, ready to render. */
  qrCodeSvg: string;
}>;
