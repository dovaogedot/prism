/**
 * JWT issuing and verification, plus the opaque tokens that are not JWTs.
 *
 * Access tokens are JWTs because they must be verifiable without a round
 * trip. Refresh and reset tokens are opaque random strings stored only as
 * SHA-256 digests, so a database leak yields digests rather than credentials.
 */

import { createHash, randomBytes } from "node:crypto";
import type { DomainError } from "@prism/shared";
import { jwtVerify, SignJWT } from "jose";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "./clock.ts";

/** What an access token asserts about the request carrying it. */
export type AccessTokenClaims = Readonly<{
  /** The user. */
  subject: string;
  /** The session, so revoking one row invalidates this token at once. */
  sessionId: string;
  /** Unique per token. */
  tokenId: string;
}>;

/** Who a two-factor challenge belongs to. It asserts nothing else. */
export type ChallengeClaims = Readonly<{ subject: string }>;

/** Minting the two signed tokens, and reading them back. */
export type TokenService = Readonly<{
  issueAccessToken: (claims: AccessTokenClaims) => ResultAsync<string, DomainError>;
  verifyAccessToken: (token: string) => ResultAsync<AccessTokenClaims, DomainError>;
  /** Proves "password accepted, 2FA still outstanding" without a database row. */
  issueTwoFactorChallenge: (claims: ChallengeClaims) => ResultAsync<string, DomainError>;
  verifyTwoFactorChallenge: (token: string) => ResultAsync<ChallengeClaims, DomainError>;
}>;

/** What the tokens are signed with, who signs them, and how long they last. */
export type TokenOptions = Readonly<{
  secret: Uint8Array;
  issuer: string;
  accessTtlSeconds: number;
  twoFactorChallengeTtlSeconds: number;
  clock: Clock;
}>;

export const TokenService = {
  ALGORITHM: "HS256",
  /** Audiences keep an access token and a challenge token apart despite one key. */
  ACCESS_AUDIENCE: "access",
  CHALLENGE_AUDIENCE: "two-factor-challenge",

  /**
   * Tokens signed and checked against the injected clock. Verification is
   * total: a bad signature, issuer, audience, expiry or claim shape is a
   * domain error, never a rejection.
   */
  create: (options: TokenOptions): TokenService => {
    const { secret, issuer, clock } = options;

    const sign = (
      audience: string,
      ttlSeconds: number,
      payload: Readonly<Record<string, string>>,
    ): ResultAsync<string, DomainError> => {
      const issuedAt = Math.floor(clock.now().getTime() / 1000);

      return ResultAsync.fromPromise(
        new SignJWT(payload)
          .setProtectedHeader({ alg: TokenService.ALGORITHM, typ: "JWT" })
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
          // Pinned: without this a token claiming `alg: none` bypasses the signature.
          algorithms: [TokenService.ALGORITHM],
          currentDate: clock.now(),
        }),
        () => onInvalid,
      ).map((result) => result.payload);

    const nonEmpty = (value: unknown): value is string =>
      typeof value === "string" && value.length > 0;

    return {
      issueAccessToken: (claims) =>
        sign(TokenService.ACCESS_AUDIENCE, options.accessTtlSeconds, {
          sub: claims.subject,
          sid: claims.sessionId,
          jti: claims.tokenId,
        }),

      verifyAccessToken: (token) =>
        verify(token, TokenService.ACCESS_AUDIENCE, { _tag: "AccessTokenInvalid" }).andThen(
          (payload) => {
            const subject = payload["sub"];
            const sessionId = payload["sid"];
            const tokenId = payload["jti"];

            // A valid signature is not a valid shape.
            return nonEmpty(subject) && nonEmpty(sessionId) && nonEmpty(tokenId)
              ? okAsync<AccessTokenClaims, DomainError>({ subject, sessionId, tokenId })
              : errAsync<AccessTokenClaims, DomainError>({ _tag: "AccessTokenInvalid" });
          },
        ),

      issueTwoFactorChallenge: (claims) =>
        sign(TokenService.CHALLENGE_AUDIENCE, options.twoFactorChallengeTtlSeconds, {
          sub: claims.subject,
        }),

      verifyTwoFactorChallenge: (token) =>
        verify(token, TokenService.CHALLENGE_AUDIENCE, { _tag: "TwoFactorCodeInvalid" }).andThen(
          (payload) => {
            const subject = payload["sub"];
            return nonEmpty(subject)
              ? okAsync<ChallengeClaims, DomainError>({ subject })
              : errAsync<ChallengeClaims, DomainError>({ _tag: "TwoFactorCodeInvalid" });
          },
        ),
    };
  },
} as const;

/** A random credential in the form sent out and the form stored. */
export type OpaqueToken = Readonly<{
  /** Sent to the user, never stored. */
  plaintext: string;
  /** Stored, never sent. */
  digest: string;
}>;

export const OpaqueToken = {
  /** 256 bits of entropy, URL-safe so it survives an email client. */
  create: (): OpaqueToken => {
    const plaintext = randomBytes(32).toString("base64url");
    return { plaintext, digest: OpaqueToken.digest(plaintext) };
  },

  /** The hex SHA-256 of a token, which is the only form of it stored. */
  digest: (plaintext: string): string => createHash("sha256").update(plaintext).digest("hex"),
} as const;
