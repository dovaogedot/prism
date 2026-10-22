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
  /** One issue per short product, with the product id as its path. */
  | Readonly<{ _tag: "OutOfStock"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "CartEmpty" }>
  | Readonly<{ _tag: "CartChanged" }>
  | Readonly<{ _tag: "PaymentsUnavailable" }>
  | Readonly<{ _tag: "PaymentGatewayUnavailable" }>
  | Readonly<{ _tag: "OrderNotFound" }>
  | Readonly<{ _tag: "OrderNotCancelable" }>
  | Readonly<{ _tag: "WebhookSignatureInvalid" }>
  | Readonly<{ _tag: "ValidationFailed"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "Forbidden" }>
  | Readonly<{ _tag: "TwoFactorSetupRequired" }>
  | Readonly<{ _tag: "TwoFactorVerificationRequired" }>
  | Readonly<{ _tag: "AccountDisabled" }>
  | Readonly<{ _tag: "LastAdmin" }>
  | Readonly<{ _tag: "SelfChangeNotAllowed" }>
  | Readonly<{ _tag: "UserNotFound" }>
  /** Why this reader cannot review this product. */
  | Readonly<{ _tag: "ReviewNotAllowed"; reason: "not_delivered" | "already_reviewed" }>
  | Readonly<{ _tag: "ReviewNotFound" }>
  | Readonly<{ _tag: "CategoryNotFound" }>
  | Readonly<{ _tag: "BrandNotFound" }>
  | Readonly<{ _tag: "CategoryInUse" }>
  | Readonly<{ _tag: "BrandInUse" }>
  | Readonly<{ _tag: "SlugTaken" }>
  | Readonly<{ _tag: "ImageNotFound" }>
  | Readonly<{ _tag: "ImageLimitReached" }>
  | Readonly<{ _tag: "UnsupportedImage" }>
  | Readonly<{ _tag: "PayloadTooLarge" }>
  /** One issue per bad cell, with `row N, column` as its path. */
  | Readonly<{ _tag: "ImportInvalid"; issues: readonly ValidationIssue[] }>
  | Readonly<{ _tag: "ShippingMethodNotFound" }>
  | Readonly<{ _tag: "ShippingMethodInUse" }>
  | Readonly<{ _tag: "OrderTransitionNotAllowed" }>
  | Readonly<{ _tag: "OrderTotalTooSmall" }>
  | Readonly<{ _tag: "AddressNotFound" }>
  | Readonly<{ _tag: "AddressLimitReached" }>
  /** Carries how long until the next attempt can pass. */
  | Readonly<{ _tag: "RateLimited"; retryAfterSeconds: number }>
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
    /** Present on `RateLimited`: whole seconds until the next attempt can pass. */
    retryAfterSeconds?: number;
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
    OutOfStock: 409,
    CartEmpty: 409,
    CartChanged: 409,
    PaymentsUnavailable: 503,
    PaymentGatewayUnavailable: 504,
    OrderNotFound: 404,
    OrderNotCancelable: 409,
    WebhookSignatureInvalid: 400,
    ValidationFailed: 422,
    Forbidden: 403,
    TwoFactorSetupRequired: 403,
    TwoFactorVerificationRequired: 403,
    AccountDisabled: 403,
    LastAdmin: 409,
    SelfChangeNotAllowed: 409,
    UserNotFound: 404,
    ReviewNotAllowed: 403,
    ReviewNotFound: 404,
    CategoryNotFound: 404,
    BrandNotFound: 404,
    CategoryInUse: 409,
    BrandInUse: 409,
    SlugTaken: 409,
    ImageNotFound: 404,
    ImageLimitReached: 409,
    UnsupportedImage: 415,
    PayloadTooLarge: 413,
    ImportInvalid: 422,
    ShippingMethodNotFound: 404,
    ShippingMethodInUse: 409,
    OrderTransitionNotAllowed: 409,
    OrderTotalTooSmall: 422,
    AddressNotFound: 404,
    AddressLimitReached: 409,
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
    OutOfStock: "Some items are not available in the quantity you asked for.",
    CartEmpty: "Your cart is empty.",
    CartChanged: "Prices or stock changed. Check the summary and place the order again.",
    PaymentsUnavailable: "Payments are not set up on this shop yet, so orders cannot be placed.",
    PaymentGatewayUnavailable: "The payment provider did not answer. You have not been charged.",
    OrderNotFound: "We could not find that order.",
    OrderNotCancelable: "This order can no longer be canceled.",
    WebhookSignatureInvalid: "The payment notification could not be verified.",
    ValidationFailed: "Please check the highlighted fields.",
    Forbidden: "Your account cannot do that.",
    TwoFactorSetupRequired: "Staff accounts need two-factor authentication. Turn it on to continue.",
    TwoFactorVerificationRequired: "Enter a code from your authenticator app to continue.",
    AccountDisabled: "This account is disabled. Contact us if you think that is a mistake.",
    LastAdmin: "The shop needs at least one admin. Make another account an admin first.",
    SelfChangeNotAllowed: "You cannot change your own roles, status or two-factor authentication here. Ask another admin.",
    UserNotFound: "We could not find that account.",
    ReviewNotAllowed: "You can review products from orders that were delivered to you.",
    ReviewNotFound: "We could not find that review.",
    CategoryNotFound: "We could not find that category.",
    BrandNotFound: "We could not find that brand.",
    CategoryInUse: "Products are filed in this category. Move or delete them first.",
    BrandInUse: "Products carry this brand. Move or delete them first.",
    SlugTaken: "Another item already uses that slug.",
    ImageNotFound: "We could not find that image.",
    ImageLimitReached: "A product can have at most 12 images.",
    UnsupportedImage: "Upload a JPEG, PNG or WebP image.",
    PayloadTooLarge: "That file is too large.",
    ImportInvalid: "The file has problems. Nothing was imported.",
    ShippingMethodNotFound: "We could not find that delivery option.",
    ShippingMethodInUse: "Orders use this delivery option, so it can be deactivated but not deleted.",
    OrderTransitionNotAllowed: "The order cannot move to that status from where it is.",
    OrderTotalTooSmall: "The order total must be at least €0.50.",
    AddressNotFound: "We could not find that address.",
    AddressLimitReached: "You can save at most 10 addresses. Delete one first.",
    RateLimited: "Too many attempts. Please wait a moment and try again.",
    Conflict: "That conflicts with something that already exists.",
  } as const satisfies Record<DomainErrorTag, string>,

  /** The status code an error is served with. */
  httpStatus: (error: DomainError): number => DomainError.status[error._tag],

  /** The sentence a person is shown for an error, with the details it carries. */
  messageOf: (error: DomainError): string => {
    if (error._tag === "RateLimited") {
      return `Too many attempts. Try again in ${DomainError.durationOf(error.retryAfterSeconds)}.`;
    }
    if (error._tag === "ReviewNotAllowed" && error.reason === "already_reviewed") {
      return "You already reviewed this product. Edit your review instead.";
    }
    return DomainError.message[error._tag];
  },

  /** A wait in words: seconds below a minute and a half, whole minutes from there. */
  durationOf: (seconds: number): string => {
    if (seconds <= 1) return "a second";
    if (seconds < 90) return `${seconds} seconds`;
    return `${Math.ceil(seconds / 60)} minutes`;
  },

  /** An error as the body it is served as. Issues are empty unless it carries some. */
  toResponse: (error: DomainError): ErrorResponse => ({
    error: {
      code: error._tag,
      message: DomainError.messageOf(error),
      issues: "issues" in error ? error.issues : [],
      ...("retryAfterSeconds" in error ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
    },
  }),
} as const;
