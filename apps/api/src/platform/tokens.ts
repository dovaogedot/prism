/**
 * JWT issuing and verification, plus the opaque tokens that are not JWTs.
 *
 * Access tokens are JWTs because they must be verifiable without a round trip.
 * Refresh and reset tokens are opaque random strings, stored only as SHA-256
 * digests — there is nothing to read inside them, and a database leak yields
 * digests rather than working credentials.
 */

import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { DomainError, UserRole } from "@hue/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { jwtVerify, SignJWT } from "jose";
import type { Clock } from "./clock.ts";

const ALGORITHM = "HS256";

export type AccessTokenClaims = Readonly<{
  /** The user. */
  subject: string;
  /** The session, so revoking one row invalidates this token immediately. */
  sessionId: string;
  role: UserRole;
  /** Unique per token, so a single token can be denied without the session. */
  tokenId: string;
}>;

export type ChallengeClaims = Readonly<{ subject: string }>;

export type TokenService = Readonly<{
  issueAccessToken: (claims: AccessTokenClaims) => ResultAsync<string, DomainError>;
  verifyAccessToken: (
    token: string,
  ) => ResultAsync<AccessTokenClaims, DomainError>;
  /** Proves "password accepted, 2FA still outstanding" without a database row. */
  issueTwoFactorChallenge: (
    claims: ChallengeClaims,
  ) => ResultAsync<string, DomainError>;
  verifyTwoFactorChallenge: (
    token: string,
  ) => ResultAsync<ChallengeClaims, DomainError>;
}>;

export type TokenOptions = Readonly<{
  secret: Uint8Array;
  issuer: string;
  accessTtlSeconds: number;
  twoFactorChallengeTtlSeconds: number;
  clock: Clock;
}>;

/** Distinguishes an access token from a challenge token of the same signature. */
const ACCESS_AUDIENCE = "access";
const CHALLENGE_AUDIENCE = "two-factor-challenge";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isUserRole = (value: unknown): value is UserRole =>
  value === "customer" || value === "admin";

export const createTokenService = (options: TokenOptions): TokenService => {
  const { secret, issuer, clock } = options;

  const sign = (
    audience: string,
    ttlSeconds: number,
    payload: Readonly<Record<string, string>>,
  ): ResultAsync<string, DomainError> => {
    const issuedAt = Math.floor(clock.now().getTime() / 1000);

    return ResultAsync.fromPromise(
      new SignJWT(payload)
        .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .sign(secret),
      (): DomainError => ({ _tag: "AccessTokenInvalid" }),
    );
  };

  const verify = (
    token: string,
    audience: string,
    onInvalid: DomainError,
  ): ResultAsync<Readonly<Record<string, unknown>>, DomainError> =>
    ResultAsync.fromPromise(
      jwtVerify(token, secret, {
        issuer,
        audience,
        // Pin the algorithm: without this, a token claiming `alg: none` or a
        // different family is a signature-verification bypass.
        algorithms: [ALGORITHM],
        currentDate: clock.now(),
      }),
      () => onInvalid,
    ).map((result) => result.payload);

  return {
    issueAccessToken: (claims) =>
      sign(ACCESS_AUDIENCE, options.accessTtlSeconds, {
        sub: claims.subject,
        sid: claims.sessionId,
        role: claims.role,
        jti: claims.tokenId,
      }),

    verifyAccessToken: (token) =>
      verify(token, ACCESS_AUDIENCE, { _tag: "AccessTokenInvalid" }).andThen(
        (payload) => {
          const subject = payload["sub"];
          const sessionId = payload["sid"];
          const role = payload["role"];
          const tokenId = payload["jti"];

          // A valid signature is not a valid shape. Check both.
          return isNonEmptyString(subject) &&
            isNonEmptyString(sessionId) &&
            isNonEmptyString(tokenId) &&
            isUserRole(role)
            ? okAsync<AccessTokenClaims, DomainError>({
                subject,
                sessionId,
                role,
                tokenId,
              })
            : errAsync<AccessTokenClaims, DomainError>({ _tag: "AccessTokenInvalid" });
        },
      ),

    issueTwoFactorChallenge: (claims) =>
      sign(CHALLENGE_AUDIENCE, options.twoFactorChallengeTtlSeconds, {
        sub: claims.subject,
      }),

    verifyTwoFactorChallenge: (token) =>
      verify(token, CHALLENGE_AUDIENCE, { _tag: "TwoFactorCodeInvalid" }).andThen(
        (payload) => {
          const subject = payload["sub"];
          return isNonEmptyString(subject)
            ? okAsync<ChallengeClaims, DomainError>({ subject })
            : errAsync<ChallengeClaims, DomainError>({ _tag: "TwoFactorCodeInvalid" });
        },
      ),
  };
};

/* ------------------------------------------------------------ opaque tokens */

export type OpaqueToken = Readonly<{
  /** Sent to the user, never stored. */
  plaintext: string;
  /** Stored, never sent. */
  digest: string;
}>;

/** 256 bits of entropy, URL-safe so it survives an email client. */
export const createOpaqueToken = (): OpaqueToken => {
  const plaintext = randomBytes(32).toString("base64url");
  return { plaintext, digest: digestToken(plaintext) };
};

export const digestToken = (plaintext: string): string =>
  createHash("sha256").update(plaintext).digest("hex");

/**
 * Constant-time comparison of two digests. Lookups go through a unique index
 * rather than a scan, but where a digest is compared in application code it is
 * compared without leaking position through timing.
 */
export const digestsMatch = (left: string, right: string): boolean => {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");

  return (
    leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
  );
};
