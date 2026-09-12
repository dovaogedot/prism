/**
 * Every way the system is allowed to fail, as one closed union.
 *
 * Services return `Result<T, DomainError>`; the HTTP layer turns the tag into
 * a status code and the browser shows the sentence. Both go through the
 * exhaustive tables on the companion object, so a variant without a status or
 * a message is a compile error.
 */

/** One rejected field: where it is in the body, and what is wrong with it. */
export type ValidationIssue = Readonly<{ path: string; message: string }>;

/** A failure the domain knows how to name. */
export type DomainError =
  | Readonly<{ _tag: "EmailAlreadyRegistered" }>
  | Readonly<{ _tag: "InvalidCredentials" }>
  | Readonly<{ _tag: "CaptchaRejected" }>
  | Readonly<{ _tag: "Unauthenticated" }>
  | Readonly<{ _tag: "AccessTokenInvalid" }>
  | Readonly<{ _tag: "RefreshTokenInvalid" }>
  | Readonly<{ _tag: "RefreshTokenReused" }>
  | Readonly<{ _tag: "SessionRevoked" }>
  | Readonly<{ _tag: "TwoFactorCodeInvalid" }>
  | Readonly<{ _tag: "TwoFactorAlreadyEnabled" }>
  | Readonly<{ _tag: "TwoFactorNotEnabled" }>
  | Readonly<{ _tag: "TwoFactorNotInitialized" }>
  | Readonly<{ _tag: "ResetTokenInvalid" }>
  | Readonly<{ _tag: "PasswordLoginUnavailable" }>
  | Readonly<{ _tag: "OAuthStateInvalid" }>
  | Readonly<{ _tag: "OAuthExchangeFailed" }>
  | Readonly<{ _tag: "OAuthProviderUnknown" }>
  | Readonly<{ _tag: "OAuthEmailUnavailable" }>
  | Readonly<{ _tag: "ProductNotFound" }>
  | Readonly<{ _tag: "ValidationFailed"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "RateLimited" }>
  | Readonly<{ _tag: "Conflict" }>;

/** The name of a domain error, which is also the `code` clients match on. */
export type DomainErrorTag = DomainError["_tag"];

/** Every code a non-2xx response can carry: the domain tags plus the two the transport adds. */
export type ErrorCode = DomainErrorTag | "NotFound" | "InternalError";

/** The wire shape of every non-2xx response. */
export type ErrorResponse = Readonly<{
  error: Readonly<{
    code: ErrorCode;
    message: string;
    issues: readonly ValidationIssue[];
  }>;
}>;

/** The tables and conversions every layer reads a `DomainError` through. */
export const DomainError = {
  /** The status code each variant is served with. */
  status: {
    EmailAlreadyRegistered: 409,
    InvalidCredentials: 401,
    CaptchaRejected: 400,
    Unauthenticated: 401,
    AccessTokenInvalid: 401,
    RefreshTokenInvalid: 401,
    RefreshTokenReused: 401,
    SessionRevoked: 401,
    TwoFactorCodeInvalid: 401,
    TwoFactorAlreadyEnabled: 409,
    TwoFactorNotEnabled: 409,
    TwoFactorNotInitialized: 409,
    ResetTokenInvalid: 400,
    PasswordLoginUnavailable: 409,
    OAuthStateInvalid: 400,
    OAuthExchangeFailed: 502,
    OAuthProviderUnknown: 404,
    OAuthEmailUnavailable: 422,
    ProductNotFound: 404,
    ValidationFailed: 422,
    RateLimited: 429,
    Conflict: 409,
  } as const satisfies Record<DomainErrorTag, number>,

  /**
   * The sentence a person is shown for each variant. Credential and token
   * failures stay vague: naming the wrong half of a pair helps an attacker.
   */
  message: {
    EmailAlreadyRegistered: "That email address is already registered.",
    InvalidCredentials: "Email or password is incorrect.",
    CaptchaRejected: "We could not verify that you are human. Please try again.",
    Unauthenticated: "Please sign in to continue.",
    AccessTokenInvalid: "Your session is no longer valid. Please sign in again.",
    RefreshTokenInvalid: "Your session has expired. Please sign in again.",
    RefreshTokenReused: "This session was ended for your security. Please sign in again.",
    SessionRevoked: "This session has been signed out.",
    TwoFactorCodeInvalid: "That code is not right. Codes change every 30 seconds.",
    TwoFactorAlreadyEnabled: "Two-factor authentication is already on.",
    TwoFactorNotEnabled: "Two-factor authentication is not turned on.",
    TwoFactorNotInitialized: "Start the two-factor setup before confirming it.",
    ResetTokenInvalid: "This reset link is invalid or has expired.",
    PasswordLoginUnavailable:
      "This account signs in through a provider. Use the provider button instead.",
    OAuthStateInvalid: "That sign-in attempt expired. Please try again.",
    OAuthExchangeFailed: "That sign-in provider is unavailable right now.",
    OAuthProviderUnknown: "We do not support signing in with that.",
    OAuthEmailUnavailable: "We could not read a verified email address from that account.",
    ProductNotFound: "We could not find that product.",
    ValidationFailed: "Please check the highlighted fields.",
    RateLimited: "Too many attempts. Please wait a moment and try again.",
    Conflict: "That conflicts with something that already exists.",
  } as const satisfies Record<DomainErrorTag, string>,

  /** The status code an error is served with. */
  httpStatus: (error: DomainError): number => DomainError.status[error._tag],

  /** The sentence a person is shown for an error. */
  messageOf: (error: DomainError): string => DomainError.message[error._tag],

  /** An error as the body it is served as. Issues are empty unless it carries some. */
  toResponse: (error: DomainError): ErrorResponse => ({
    error: {
      code: error._tag,
      message: DomainError.message[error._tag],
      issues: error._tag === "ValidationFailed" ? error.issues : [],
    },
  }),
} as const;
