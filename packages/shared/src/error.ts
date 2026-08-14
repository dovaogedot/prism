/**
 * Every way this system is allowed to fail, as one closed union.
 *
 * Services return `Result<T, DomainError>`; the HTTP layer turns the tag into a
 * status code and the browser turns it into a sentence. Both directions go
 * through the exhaustive records below, so adding a variant is a compile error
 * in every place that has to handle it — which is the point.
 */

export type DomainError =
  // Registration and sign-in
  | Readonly<{ _tag: "EmailAlreadyRegistered" }>
  | Readonly<{ _tag: "InvalidCredentials" }>
  | Readonly<{ _tag: "CaptchaRejected" }>
  // Tokens and sessions
  | Readonly<{ _tag: "Unauthenticated" }>
  | Readonly<{ _tag: "Forbidden" }>
  | Readonly<{ _tag: "AccessTokenInvalid" }>
  | Readonly<{ _tag: "RefreshTokenInvalid" }>
  | Readonly<{ _tag: "RefreshTokenReused" }>
  | Readonly<{ _tag: "SessionRevoked" }>
  // Two-factor authentication
  | Readonly<{ _tag: "TwoFactorRequired" }>
  | Readonly<{ _tag: "TwoFactorCodeInvalid" }>
  | Readonly<{ _tag: "TwoFactorAlreadyEnabled" }>
  | Readonly<{ _tag: "TwoFactorNotEnabled" }>
  | Readonly<{ _tag: "TwoFactorNotInitialised" }>
  // Password recovery
  | Readonly<{ _tag: "ResetTokenInvalid" }>
  | Readonly<{ _tag: "PasswordLoginUnavailable" }>
  // OAuth
  | Readonly<{ _tag: "OAuthStateInvalid" }>
  | Readonly<{ _tag: "OAuthExchangeFailed" }>
  | Readonly<{ _tag: "OAuthProviderUnknown" }>
  | Readonly<{ _tag: "OAuthEmailUnavailable" }>
  // Catalogue
  | Readonly<{ _tag: "ProductNotFound" }>
  | Readonly<{ _tag: "CategoryNotFound" }>
  | Readonly<{ _tag: "ImageTypeUnsupported" }>
  | Readonly<{ _tag: "ImageTooLarge" }>
  // Transport
  | Readonly<{ _tag: "ValidationFailed"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "RateLimited" }>
  | Readonly<{ _tag: "Conflict" }>;

export type ValidationIssue = Readonly<{ path: string; message: string }>;

export type DomainErrorTag = DomainError["_tag"];

/**
 * A `Record` keyed by the tag union is exhaustive by construction — the
 * compiler rejects the file the moment a variant is added without a status.
 */
export const httpStatusByTag: Record<DomainErrorTag, number> = {
  EmailAlreadyRegistered: 409,
  InvalidCredentials: 401,
  CaptchaRejected: 400,

  Unauthenticated: 401,
  Forbidden: 403,
  AccessTokenInvalid: 401,
  RefreshTokenInvalid: 401,
  RefreshTokenReused: 401,
  SessionRevoked: 401,

  TwoFactorRequired: 401,
  TwoFactorCodeInvalid: 401,
  TwoFactorAlreadyEnabled: 409,
  TwoFactorNotEnabled: 409,
  TwoFactorNotInitialised: 409,

  ResetTokenInvalid: 400,
  PasswordLoginUnavailable: 409,

  OAuthStateInvalid: 400,
  OAuthExchangeFailed: 502,
  OAuthProviderUnknown: 404,
  OAuthEmailUnavailable: 422,

  ProductNotFound: 404,
  CategoryNotFound: 404,
  ImageTypeUnsupported: 415,
  ImageTooLarge: 413,

  ValidationFailed: 422,
  RateLimited: 429,
  Conflict: 409,
};

/**
 * Wording shown to end users. Credential and token failures are deliberately
 * vague: telling an attacker which half of the pair was wrong is free help.
 */
export const messageByTag: Record<DomainErrorTag, string> = {
  EmailAlreadyRegistered: "That email address is already registered.",
  InvalidCredentials: "Email or password is incorrect.",
  CaptchaRejected: "We could not verify that you are human. Please try again.",

  Unauthenticated: "Please sign in to continue.",
  Forbidden: "You do not have access to this.",
  AccessTokenInvalid: "Your session is no longer valid. Please sign in again.",
  RefreshTokenInvalid: "Your session has expired. Please sign in again.",
  RefreshTokenReused:
    "This session was ended for your security. Please sign in again.",
  SessionRevoked: "This session has been signed out.",

  TwoFactorRequired: "Enter the code from your authenticator app.",
  TwoFactorCodeInvalid: "That code is not right. Codes change every 30 seconds.",
  TwoFactorAlreadyEnabled: "Two-factor authentication is already on.",
  TwoFactorNotEnabled: "Two-factor authentication is not turned on.",
  TwoFactorNotInitialised: "Start the two-factor setup before confirming it.",

  ResetTokenInvalid: "This reset link is invalid or has expired.",
  PasswordLoginUnavailable:
    "This account signs in with Google. Use the Google button instead.",

  OAuthStateInvalid: "That sign-in attempt expired. Please try again.",
  OAuthExchangeFailed: "That sign-in provider is unavailable right now.",
  OAuthProviderUnknown: "We do not support signing in with that.",
  OAuthEmailUnavailable:
    "We could not read a verified email address from that account.",

  ProductNotFound: "We could not find that colour.",
  CategoryNotFound: "We could not find that category.",
  ImageTypeUnsupported: "Images must be PNG, JPEG, or WebP.",
  ImageTooLarge: "That image is too large.",

  ValidationFailed: "Please check the highlighted fields.",
  RateLimited: "Too many attempts. Please wait a moment and try again.",
  Conflict: "That conflicts with something that already exists.",
};

/** Every variant except the one that carries data. */
export type TaglessDomainErrorTag = Exclude<DomainErrorTag, "ValidationFailed">;

/**
 * Ready-made instances of the data-free variants.
 *
 * `{ _tag: someUnionOfTags }` cannot be assigned to `DomainError` — the union
 * is large enough that TypeScript stops distributing the object literal across
 * its members — so reconstructing an error from a tag received over the wire
 * goes through this table instead of a cast.
 *
 * `satisfies` makes it exhaustive: omitting a variant, or inventing one, is a
 * compile error here.
 */
export const TAGLESS_ERRORS = {
  EmailAlreadyRegistered: { _tag: "EmailAlreadyRegistered" },
  InvalidCredentials: { _tag: "InvalidCredentials" },
  CaptchaRejected: { _tag: "CaptchaRejected" },

  Unauthenticated: { _tag: "Unauthenticated" },
  Forbidden: { _tag: "Forbidden" },
  AccessTokenInvalid: { _tag: "AccessTokenInvalid" },
  RefreshTokenInvalid: { _tag: "RefreshTokenInvalid" },
  RefreshTokenReused: { _tag: "RefreshTokenReused" },
  SessionRevoked: { _tag: "SessionRevoked" },

  TwoFactorRequired: { _tag: "TwoFactorRequired" },
  TwoFactorCodeInvalid: { _tag: "TwoFactorCodeInvalid" },
  TwoFactorAlreadyEnabled: { _tag: "TwoFactorAlreadyEnabled" },
  TwoFactorNotEnabled: { _tag: "TwoFactorNotEnabled" },
  TwoFactorNotInitialised: { _tag: "TwoFactorNotInitialised" },

  ResetTokenInvalid: { _tag: "ResetTokenInvalid" },
  PasswordLoginUnavailable: { _tag: "PasswordLoginUnavailable" },

  OAuthStateInvalid: { _tag: "OAuthStateInvalid" },
  OAuthExchangeFailed: { _tag: "OAuthExchangeFailed" },
  OAuthProviderUnknown: { _tag: "OAuthProviderUnknown" },
  OAuthEmailUnavailable: { _tag: "OAuthEmailUnavailable" },

  ProductNotFound: { _tag: "ProductNotFound" },
  CategoryNotFound: { _tag: "CategoryNotFound" },
  ImageTypeUnsupported: { _tag: "ImageTypeUnsupported" },
  ImageTooLarge: { _tag: "ImageTooLarge" },

  RateLimited: { _tag: "RateLimited" },
  Conflict: { _tag: "Conflict" },
} as const satisfies Record<TaglessDomainErrorTag, DomainError>;

export const httpStatusOf = (error: DomainError): number =>
  httpStatusByTag[error._tag];

export const messageOf = (error: DomainError): string => messageByTag[error._tag];

/** The wire shape for every non-2xx response. */
export type ErrorResponse = Readonly<{
  error: Readonly<{
    code: DomainErrorTag;
    message: string;
    issues: readonly ValidationIssue[];
  }>;
}>;

export const toErrorResponse = (error: DomainError): ErrorResponse => ({
  error: {
    code: error._tag,
    message: messageOf(error),
    issues: error._tag === "ValidationFailed" ? error.issues : [],
  },
});
