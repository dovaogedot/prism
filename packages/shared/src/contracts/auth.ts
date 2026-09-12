/**
 * One schema per request shape, used twice: Fastify validates with it, and
 * react-hook-form checks the same rules in the browser. Validation on both
 * sides without two definitions that can drift apart.
 */

import { z } from "zod";

/** An email address, trimmed and lowercased so equality is string equality. */
export const Email = {
  /** The longest address RFC 5321 allows. */
  MAX_LENGTH: 254,
  schema: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a valid email address.").max(254)),
} as const;

/**
 * A password a new account is allowed to have: long enough, and not a guess.
 * NIST SP 800-63B: length and a breach check beat composition rules. A short
 * denylist stands in for the breach corpus at this scale.
 */
export const Password = {
  MIN_LENGTH: 12,
  MAX_LENGTH: 128,
  COMMON: new Set([
    "password123",
    "123456789012",
    "qwertyuiop12",
    "iloveshopping",
    "letmeinplease",
    "administrator",
  ]),
  schema: z
    .string()
    .min(12, "Use at least 12 characters.")
    .max(128, "Use at most 128 characters.")
    .refine(
      (password: string): boolean => !Password.COMMON.has(password.toLowerCase()),
      "That password is too easy to guess.",
    ),
  /** The browser-only confirmation field and the check that it matches. */
  confirmation: z.string().min(1, "Repeat the password."),
  matches: (values: Readonly<{ password: string; confirmPassword: string }>) =>
    values.password === values.confirmPassword,
  mismatch: { message: "The two passwords do not match.", path: ["confirmPassword"] },
};

/** A six-digit authenticator code. */
export const TotpCode = {
  schema: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from your authenticator app."),
} as const;

/** A validated `POST /auth/register` body. */
export type RegisterInput = z.infer<typeof RegisterInput.schema>;
export const RegisterInput = {
  schema: z.object({
    email: Email.schema,
    password: Password.schema,
    captchaToken: z.string().min(1, "Complete the CAPTCHA to continue."),
  }),
} as const;

/**
 * A validated `POST /auth/login` body. The password is checked for presence
 * only: sign-in must not reveal that a stored password would fail today's
 * registration rules.
 */
export type LoginInput = z.infer<typeof LoginInput.schema>;
export const LoginInput = {
  schema: z.object({
    email: Email.schema,
    password: z.string().min(1, "Enter your password."),
  }),
} as const;

/**
 * A validated second-factor body. The challenge arrives in the body after a
 * password sign-in, and in a short-lived httpOnly cookie after an OAuth
 * redirect, which has no page to hand it to.
 */
export type TwoFactorLoginInput = z.infer<typeof TwoFactorLoginInput.schema>;
export const TwoFactorLoginInput = {
  schema: z.object({
    challengeToken: z.string().min(1).optional(),
    code: TotpCode.schema,
  }),
} as const;

/** A validated `POST /auth/password/forgot` body. */
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordInput.schema>;
export const ForgotPasswordInput = {
  schema: z.object({ email: Email.schema }),
} as const;

/** A validated `POST /auth/password/reset` body. */
export type ResetPasswordInput = z.infer<typeof ResetPasswordInput.schema>;
export const ResetPasswordInput = {
  schema: z.object({ token: z.string().min(1), password: Password.schema }),
} as const;

/**
 * A validated change-password body. `currentPassword` is required of an
 * account that has one; an account created through a provider has nothing to
 * confirm. The server decides which case applies.
 */
export type ChangePasswordInput = z.infer<typeof ChangePasswordInput.schema>;
export const ChangePasswordInput = {
  schema: z.object({
    currentPassword: z.string().min(1).optional(),
    password: Password.schema,
  }),
} as const;

/** A validated body that proves the enrolled secret was scanned, or turns it off. */
export type TwoFactorCodeInput = z.infer<typeof TwoFactorCodeInput.schema>;
export const TwoFactorCodeInput = {
  schema: z.object({ code: TotpCode.schema }),
} as const;

/** The register form: the request body plus the browser-only confirmation. */
export type RegisterForm = z.infer<typeof RegisterForm.schema>;
export const RegisterForm = {
  schema: RegisterInput.schema
    .extend({ confirmPassword: Password.confirmation })
    .refine(Password.matches, Password.mismatch),
} as const;

/** The reset form: the request body plus the browser-only confirmation. */
export type ResetPasswordForm = z.infer<typeof ResetPasswordForm.schema>;
export const ResetPasswordForm = {
  schema: ResetPasswordInput.schema
    .extend({ confirmPassword: Password.confirmation })
    .refine(Password.matches, Password.mismatch),
} as const;

/**
 * The password form on the account page. `change` confirms the current
 * password; `set` serves an account that has none. Both infer one values
 * type, so one component serves either.
 */
export type PasswordForm = z.infer<typeof PasswordForm.change>;
export const PasswordForm = {
  change: ChangePasswordInput.schema
    .extend({
      currentPassword: z.string().min(1, "Enter your current password."),
      confirmPassword: Password.confirmation,
    })
    .refine(Password.matches, Password.mismatch),
  set: ChangePasswordInput.schema
    .extend({ currentPassword: z.string(), confirmPassword: Password.confirmation })
    .refine(Password.matches, Password.mismatch),
} as const;

/**
 * One third-party sign-in, named the way its routes and columns name it. The
 * routes, the mock provider and the sign-in buttons are all driven off `NAMES`.
 */
export type OAuthProvider = (typeof OAuthProvider.NAMES)[number];
export const OAuthProvider = {
  NAMES: ["google", "github"] as const,
  /** A provider name arriving from a client, which may be anything at all. */
  schema: z.enum(["google", "github"]),
  /** How each provider spells its own name on a button. */
  label: { google: "Google", github: "GitHub" } as const satisfies Record<
    "google" | "github",
    string
  >,
} as const;

/** What `GET /auth/oauth/providers` answers, so the UI shows only live buttons. */
export type AvailableProviders = Readonly<{
  providers: readonly OAuthProvider[];
  /** True when the built-in offline stand-in answers instead of the real provider. */
  mock: boolean;
}>;

/** Who is signed in, as every authenticated response reports it. */
export type SessionUser = Readonly<{
  id: string;
  email: string;
  twoFactorEnabled: boolean;
  /** Whether a password is set; an account without one signs in through a provider. */
  hasPassword: boolean;
  /** Linked providers, alphabetically. */
  providers: readonly string[];
}>;

/**
 * The access token never touches storage: it lives in a module variable in
 * the browser and dies with the tab. The refresh cookie survives a reload.
 */
export type AccessGrant = Readonly<{
  accessToken: string;
  expiresInSeconds: number;
  user: SessionUser;
}>;

/** The sign-in outcome that asks for a second factor before granting anything. */
export type TwoFactorChallenge = Readonly<{
  status: "two_factor_required";
  challengeToken: string;
}>;

/** Sign-in is two outcomes, so it is a tagged union rather than optional fields. */
export type LoginOutcome =
  | Readonly<{ status: "authenticated"; grant: AccessGrant }>
  | TwoFactorChallenge;

/** The secret being enrolled, in the two forms an authenticator app accepts. */
export type TwoFactorSetup = Readonly<{
  /** `otpauth://` URI for manual entry. */
  uri: string;
  /** The same URI as an inline SVG QR code. */
  qrCodeSvg: string;
}>;
