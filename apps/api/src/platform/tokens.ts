/**
 * JWT issuing and verification, plus the opaque tokens that are not JWTs.
 *
 * Access tokens are JWTs because they must be verifiable without a round
 * trip. Refresh and reset tokens are opaque random strings stored only as
 * SHA-256 digests, so a database leak yields digests rather than credentials.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AccessToken, ChallengeToken, UserId, type DomainError } from "@prism/shared";
import { jwtVerify, SignJWT } from "jose";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { z } from "zod";
import { SessionId } from "../db/ids.ts";
import type { Clock } from "./clock.ts";

const tokenIdSchema = z.uuid().brand<"TokenId">();

/** What tells one access token from every other. */
export type TokenId = z.infer<typeof tokenIdSchema>;
export const TokenId = {
  schema: tokenIdSchema,
  fresh: (): TokenId => tokenIdSchema.parse(randomUUID()),
} as const;

/** The form a refresh token is sent in. Only `OpaqueToken.create` makes one. */
export type RefreshToken = z.infer<typeof RefreshToken.schema>;
export const RefreshToken = {
  schema: z.string().min(1).brand<"RefreshToken">(),
} as const;

/** The hex SHA-256 of an opaque token, which is the only form of it stored. */
export type Digest = z.infer<typeof Digest.schema>;
export const Digest = {
  schema: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .brand<"Digest">(),
} as const;

/** What an access token asserts about the request carrying it. */
export type AccessTokenClaims = Readonly<{
  /** The user. */
  subject: UserId;
  /** The session, so revoking one row invalidates this token at once. */
  sessionId: SessionId;
  /** Unique per token. */
  tokenId: TokenId;
}>;

/** Who a two-factor challenge belongs to. It asserts nothing else. */
export type ChallengeClaims = Readonly<{ subject: UserId }>;

/** Minting the two signed tokens, and reading them back. */
export type TokenService = Readonly<{
  issueAccessToken: (claims: AccessTokenClaims) => ResultAsync<AccessToken, DomainError>;
  verifyAccessToken: (token: string) => ResultAsync<AccessTokenClaims, DomainError>;
  /** Proves "password accepted, 2FA still outstanding" without a database row. */
  issueTwoFactorChallenge: (claims: ChallengeClaims) => ResultAsync<ChallengeToken, DomainError>;
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

/** The claims of each token as they travel in the JWT payload. */
const accessPayload = z.object({ sub: UserId.schema, sid: SessionId.schema, jti: TokenId.schema });
const challengePayload = z.object({ sub: UserId.schema });

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

    return {
      issueAccessToken: (claims) =>
        sign(TokenService.ACCESS_AUDIENCE, options.accessTtlSeconds, {
          sub: claims.subject,
          sid: claims.sessionId,
          jti: claims.tokenId,
        }).map((token) => AccessToken.schema.parse(token)),

      verifyAccessToken: (token) =>
        verify(token, TokenService.ACCESS_AUDIENCE, { _tag: "AccessTokenInvalid" }).andThen((payload) => {
          // A valid signature is not a valid shape.
          const claims = accessPayload.safeParse(payload);

          return claims.success
            ? okAsync<AccessTokenClaims, DomainError>({
                subject: claims.data.sub,
                sessionId: claims.data.sid,
                tokenId: claims.data.jti,
              })
            : errAsync<AccessTokenClaims, DomainError>({ _tag: "AccessTokenInvalid" });
        }),

      issueTwoFactorChallenge: (claims) =>
        sign(TokenService.CHALLENGE_AUDIENCE, options.twoFactorChallengeTtlSeconds, {
          sub: claims.subject,
        }).map((token) => ChallengeToken.schema.parse(token)),

      verifyTwoFactorChallenge: (token) =>
        verify(token, TokenService.CHALLENGE_AUDIENCE, { _tag: "TwoFactorCodeInvalid" }).andThen((payload) => {
          const claims = challengePayload.safeParse(payload);

          return claims.success
            ? okAsync<ChallengeClaims, DomainError>({ subject: claims.data.sub })
            : errAsync<ChallengeClaims, DomainError>({ _tag: "TwoFactorCodeInvalid" });
        }),
    };
  },
} as const;

/** A random credential in the form sent out and the form stored. */
export type OpaqueToken<T extends string> = Readonly<{
  /** Sent to the user, never stored. */
  plaintext: T;
  /** Stored, never sent. */
  digest: Digest;
}>;

export const OpaqueToken = {
  /** 256 bits of entropy, URL-safe so it survives an email client, in the form `schema` names. */
  create: <S extends z.ZodType<string>>(schema: S): OpaqueToken<z.output<S>> => {
    const plaintext = schema.parse(randomBytes(32).toString("base64url"));
    return { plaintext, digest: OpaqueToken.digest(plaintext) };
  },

  digest: (plaintext: string): Digest =>
    Digest.schema.parse(createHash("sha256").update(plaintext).digest("hex")),
} as const;
