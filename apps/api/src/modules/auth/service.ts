/**
 * Authentication domain logic over ports. No adapter is imported here, which
 * is what lets tests run the real logic against fakes. Every operation
 * returns `ResultAsync<T, DomainError>`; nothing throws.
 */

import {
  ResetToken,
  type AccessGrant,
  type AvailableProviders,
  type CaptchaToken,
  type ChallengeToken,
  type DomainError,
  type Email,
  type LoginOutcome,
  type OAuthProvider,
  type SessionUser,
  type TotpCode,
  type TwoFactorChallenge,
  type TwoFactorSetup,
  type UserId,
} from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionId } from "../../db/ids.ts";
import type { CaptchaVerifier } from "../../platform/captcha.ts";
import { Clock } from "../../platform/clock.ts";
import type { Hasher } from "../../platform/hasher.ts";
import type { Mailer } from "../../platform/mailer.ts";
import {
  OAuthState,
  type AuthorizationCode,
  type IdentityProviders,
  type ProviderSubject,
  type RedirectUri,
} from "../../platform/oauth.ts";
import { OpaqueToken, RefreshToken, TokenId, type TokenService } from "../../platform/tokens.ts";
import type { TotpService } from "../../platform/totp.ts";
import { PasswordResetEmail } from "./emails.ts";
import { UserRecord, type AuthRepository } from "./repository.ts";

/** Every port the auth module works through. */
export type AuthDependencies = Readonly<{
  repository: AuthRepository;
  clock: Clock;
  hasher: Hasher;
  tokens: TokenService;
  totp: TotpService;
  mailer: Mailer;
  captcha: CaptchaVerifier;
  oauth: IdentityProviders;
  webOrigin: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  passwordResetTtlSeconds: number;
}>;

/** What the caller learns about the browser, for the session audit trail. */
export type RequestContext = Readonly<{ userAgent: string; ipAddress: string }>;

/** The refresh token travels in a cookie, so it leaves the service separately. */
export type IssuedSession = Readonly<{
  grant: AccessGrant;
  refreshToken: RefreshToken;
  refreshExpiresAt: Date;
}>;

/** Everything an account can do, with every failure a `DomainError`. */
export type AuthService = Readonly<{
  register: (input: {
    email: Email;
    password: string;
    captchaToken: CaptchaToken;
    context: RequestContext;
  }) => ResultAsync<IssuedSession, DomainError>;
  login: (input: {
    email: Email;
    password: string;
    context: RequestContext;
  }) => ResultAsync<LoginOutcome | IssuedSession, DomainError>;
  completeTwoFactorLogin: (input: {
    challengeToken: ChallengeToken;
    code: TotpCode;
    context: RequestContext;
  }) => ResultAsync<IssuedSession, DomainError>;
  refresh: (presentedToken: RefreshToken) => ResultAsync<IssuedSession, DomainError>;
  logout: (sessionId: SessionId) => ResultAsync<void, DomainError>;
  currentUser: (userId: UserId) => ResultAsync<SessionUser, DomainError>;
  /** Succeeds whether or not the address exists, so it is not an oracle. */
  requestPasswordReset: (email: Email) => ResultAsync<void, DomainError>;
  changePassword: (input: {
    userId: UserId;
    currentPassword?: string;
    password: string;
  }) => ResultAsync<SessionUser, DomainError>;
  resetPassword: (input: { token: ResetToken; password: string }) => ResultAsync<void, DomainError>;
  beginTwoFactorSetup: (userId: UserId) => ResultAsync<TwoFactorSetup, DomainError>;
  enableTwoFactor: (input: { userId: UserId; code: TotpCode }) => ResultAsync<SessionUser, DomainError>;
  disableTwoFactor: (input: { userId: UserId; code: TotpCode }) => ResultAsync<SessionUser, DomainError>;
  availableProviders: () => AvailableProviders;
  oauthAuthorizationUrl: (input: {
    provider: OAuthProvider;
    redirectUri: RedirectUri;
  }) => ResultAsync<Readonly<{ url: string; state: OAuthState }>, DomainError>;
  /** A challenge rather than a session when the account has a second factor. */
  completeOAuthLogin: (input: {
    provider: OAuthProvider;
    code: AuthorizationCode;
    redirectUri: RedirectUri;
    context: RequestContext;
  }) => ResultAsync<TwoFactorChallenge | IssuedSession, DomainError>;
}>;

export const AuthService = {
  create: (deps: AuthDependencies): AuthService => {
    const { repository, clock, hasher, tokens, totp, mailer, captcha, oauth } = deps;

    const requireUser = (userId: UserId, missing: DomainError): ResultAsync<UserRecord, DomainError> =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) =>
        found === undefined ? errAsync<UserRecord, DomainError>(missing) : okAsync<UserRecord, DomainError>(found),
      );

    const grantFor = (
      user: UserRecord,
      sessionId: SessionId,
      refreshToken: RefreshToken,
      refreshExpiresAt: Date,
    ): ResultAsync<IssuedSession, DomainError> =>
      tokens
        .issueAccessToken({ subject: user.id, sessionId, tokenId: TokenId.fresh() })
        .map((accessToken) => ({
          grant: { accessToken, expiresInSeconds: deps.accessTtlSeconds, user: UserRecord.toSessionUser(user) },
          refreshToken,
          refreshExpiresAt,
        }));

    /** Mints a session: one row, one opaque refresh token, one JWT. */
    const issueSession = (user: UserRecord, context: RequestContext): ResultAsync<IssuedSession, DomainError> => {
      const refresh = OpaqueToken.create(RefreshToken.schema);
      const refreshExpiresAt = Clock.after(clock, deps.refreshTtlSeconds);

      return ResultAsync.fromSafePromise(
        repository.createSession({
          userId: user.id,
          expiresAt: refreshExpiresAt,
          userAgent: context.userAgent,
          ipAddress: context.ipAddress,
          refreshTokenDigest: refresh.digest,
          refreshExpiresAt,
        }),
      ).andThen((session) => grantFor(user, session.id, refresh.plaintext, refreshExpiresAt));
    };

    const challenge = (user: UserRecord): ResultAsync<TwoFactorChallenge, DomainError> =>
      tokens
        .issueTwoFactorChallenge({ subject: user.id })
        .map((challengeToken) => ({ status: "two_factor_required", challengeToken }));

    /**
     * A provider proves who owns the third-party account, not that the second
     * factor this account asked for was satisfied, so it is asked for here too.
     */
    const signInOAuth = (
      user: UserRecord,
      context: RequestContext,
    ): ResultAsync<TwoFactorChallenge | IssuedSession, DomainError> =>
      user.totpEnabledAt === undefined ? issueSession(user, context) : challenge(user);

    const linkAndSignIn = (
      user: UserRecord,
      provider: OAuthProvider,
      subject: ProviderSubject,
      context: RequestContext,
    ): ResultAsync<TwoFactorChallenge | IssuedSession, DomainError> =>
      ResultAsync.fromSafePromise(
        repository.linkOAuthIdentity({ userId: user.id, provider, subject }),
      ).andThen(() => signInOAuth(UserRecord.withProvider(user, provider), context));

    return {
      register: ({ email, password, captchaToken, context }) =>
        captcha
          .verify(captchaToken, context.ipAddress)
          .andThen(() => ResultAsync.fromSafePromise(hasher.hash(password)))
          .andThen((passwordHash) => repository.createUser({ email, passwordHash }))
          .andThen((user) => issueSession(user, context)),

      login: ({ email, password, context }) =>
        ResultAsync.fromSafePromise(repository.findUserByEmail(email)).andThen((user) => {
          // An unknown address and a provider-only account both spend the CPU a
          // real verification would, so timing reveals neither.
          if (user === undefined || user.passwordHash === undefined) {
            const error: DomainError =
              user === undefined ? { _tag: "InvalidCredentials" } : { _tag: "PasswordLoginUnavailable" };
            return ResultAsync.fromSafePromise(hasher.fakeVerify()).andThen(() =>
              errAsync<LoginOutcome | IssuedSession, DomainError>(error),
            );
          }

          return ResultAsync.fromSafePromise(hasher.verify(user.passwordHash, password)).andThen((matches) => {
            if (!matches) return errAsync<LoginOutcome | IssuedSession, DomainError>({ _tag: "InvalidCredentials" });
            // The password was right, but it is not sufficient on its own.
            return user.totpEnabledAt === undefined ? issueSession(user, context) : challenge(user);
          });
        }),

      completeTwoFactorLogin: ({ challengeToken, code, context }) =>
        tokens
          .verifyTwoFactorChallenge(challengeToken)
          .andThen((claims) => requireUser(claims.subject, { _tag: "TwoFactorCodeInvalid" }))
          .andThen((user) => {
            if (user.totpSecret === undefined || user.totpEnabledAt === undefined) {
              return errAsync<IssuedSession, DomainError>({ _tag: "TwoFactorNotEnabled" });
            }
            return totp.verify(user.totpSecret, code)
              ? issueSession(user, context)
              : errAsync<IssuedSession, DomainError>({ _tag: "TwoFactorCodeInvalid" });
          }),

      refresh: (presentedToken) => {
        const replacement = OpaqueToken.create(RefreshToken.schema);
        const replacementExpiresAt = Clock.after(clock, deps.refreshTtlSeconds);

        return ResultAsync.fromSafePromise(
          repository.rotateRefreshToken({
            presentedDigest: OpaqueToken.digest(presentedToken),
            replacementDigest: replacement.digest,
            now: clock.now(),
            replacementExpiresAt,
          }),
        ).andThen((outcome) => {
          switch (outcome._tag) {
            case "Rotated":
              return requireUser(outcome.userId, { _tag: "RefreshTokenInvalid" }).andThen((user) =>
                grantFor(user, outcome.sessionId, replacement.plaintext, replacementExpiresAt),
              );
            case "Replayed":
              return errAsync<IssuedSession, DomainError>({ _tag: "RefreshTokenReused" });
            case "SessionEnded":
              return errAsync<IssuedSession, DomainError>({ _tag: "SessionRevoked" });
            case "Unknown":
              return errAsync<IssuedSession, DomainError>({ _tag: "RefreshTokenInvalid" });
          }
        });
      },

      logout: (sessionId) => ResultAsync.fromSafePromise(repository.revokeSession(sessionId, "logout")),

      currentUser: (userId) => requireUser(userId, { _tag: "Unauthenticated" }).map(UserRecord.toSessionUser),

      requestPasswordReset: (email) =>
        ResultAsync.fromSafePromise(
          repository.findUserByEmail(email).then(async (user) => {
            if (user === undefined) return;

            const reset = OpaqueToken.create(ResetToken.schema);
            const expiresAt = Clock.after(clock, deps.passwordResetTtlSeconds);

            await repository.createPasswordResetToken({ userId: user.id, digest: reset.digest, expiresAt });
            await mailer.send(
              PasswordResetEmail.compose({
                to: user.email,
                resetUrl: `${deps.webOrigin}/reset-password?token=${encodeURIComponent(reset.plaintext)}`,
                expiresInMinutes: Math.round(deps.passwordResetTtlSeconds / 60),
              }),
            );
          }),
        ),

      /**
       * An account with a password must prove it knows the old one, so a
       * stolen session cannot lock the owner out; an account created through a
       * provider has nothing to prove. Other sessions are left alone: the
       * reset-by-email flow is the one that assumes compromise.
       */
      changePassword: ({ userId, currentPassword, password }) =>
        requireUser(userId, { _tag: "Unauthenticated" }).andThen((user) => {
          const confirmed: ResultAsync<boolean, DomainError> =
            user.passwordHash === undefined
              ? okAsync(true)
              : currentPassword === undefined
                ? okAsync(false)
                : ResultAsync.fromSafePromise(hasher.verify(user.passwordHash, currentPassword));

          return confirmed.andThen((ok) =>
            !ok
              ? errAsync<SessionUser, DomainError>({ _tag: "InvalidCredentials" })
              : ResultAsync.fromSafePromise(
                  hasher.hash(password).then(async (passwordHash) => {
                    await repository.setPasswordHash(userId, passwordHash);
                    return UserRecord.toSessionUser({ ...user, passwordHash });
                  }),
                ),
          );
        }),

      resetPassword: ({ token, password }) =>
        // Hashed before the transaction opens, so no row stays locked while
        // argon2 runs. An invalid token still costs one hash; the route's rate
        // limit bounds that.
        ResultAsync.fromSafePromise(hasher.hash(password))
          .andThen((passwordHash) =>
            ResultAsync.fromSafePromise(
              repository.resetPassword({ digest: OpaqueToken.digest(token), passwordHash, now: clock.now() }),
            ),
          )
          .andThen((outcome) =>
            outcome._tag === "Reset"
              ? okAsync<void, DomainError>(undefined)
              : errAsync<void, DomainError>({ _tag: "ResetTokenInvalid" }),
          ),

      beginTwoFactorSetup: (userId) =>
        requireUser(userId, { _tag: "Unauthenticated" }).andThen((user) => {
          if (user.totpEnabledAt !== undefined) {
            return errAsync<TwoFactorSetup, DomainError>({ _tag: "TwoFactorAlreadyEnabled" });
          }

          const secret = totp.generateSecret();
          const uri = totp.keyUri(user.email, secret);

          return ResultAsync.fromSafePromise(
            repository
              .setTotpSecret(userId, secret)
              .then(() => totp.qrCodeSvg(uri))
              .then((qrCodeSvg): TwoFactorSetup => ({ uri, qrCodeSvg })),
          );
        }),

      enableTwoFactor: ({ userId, code }) =>
        requireUser(userId, { _tag: "Unauthenticated" }).andThen((user) => {
          if (user.totpEnabledAt !== undefined) {
            return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorAlreadyEnabled" });
          }
          if (user.totpSecret === undefined) {
            return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorNotInitialized" });
          }
          // One live code proves the secret reached the phone.
          if (!totp.verify(user.totpSecret, code)) {
            return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorCodeInvalid" });
          }

          const enabledAt = clock.now();

          return ResultAsync.fromSafePromise(
            repository.enableTotp(userId, enabledAt).then(() => UserRecord.toSessionUser({ ...user, totpEnabledAt: enabledAt })),
          );
        }),

      disableTwoFactor: ({ userId, code }) =>
        requireUser(userId, { _tag: "Unauthenticated" }).andThen((user) => {
          if (user.totpEnabledAt === undefined || user.totpSecret === undefined) {
            return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorNotEnabled" });
          }
          // Turning the second factor off is itself a sensitive action.
          if (!totp.verify(user.totpSecret, code)) {
            return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorCodeInvalid" });
          }

          const { totpSecret: _secret, totpEnabledAt: _enabledAt, ...rest } = user;

          return ResultAsync.fromSafePromise(
            repository.disableTotp(userId).then(() => UserRecord.toSessionUser(rest)),
          );
        }),

      availableProviders: () => ({ providers: oauth.names, mock: oauth.isMock }),

      oauthAuthorizationUrl: ({ provider, redirectUri }) => {
        const chosen = oauth.find(provider);

        if (chosen === undefined) {
          return errAsync<{ url: string; state: OAuthState }, DomainError>({ _tag: "OAuthProviderUnknown" });
        }

        // Kept in a cookie by the route and compared on the way back, so a
        // callback this browser did not start is rejected.
        const state = OpaqueToken.create(OAuthState.schema).plaintext;

        return okAsync({ url: chosen.authorizationUrl(state, redirectUri), state });
      },

      completeOAuthLogin: ({ provider, code, redirectUri, context }) => {
        const chosen = oauth.find(provider);

        if (chosen === undefined) {
          return errAsync<IssuedSession, DomainError>({ _tag: "OAuthProviderUnknown" });
        }

        return chosen.exchange(code, redirectUri).andThen((profile) =>
          ResultAsync.fromSafePromise(
            repository.findUserByOAuthIdentity(profile.provider, profile.subject),
          ).andThen((linked) => {
            if (linked !== undefined) return signInOAuth(linked, context);

            // First sign-in with this provider: an address that already has an
            // account is linked to it rather than duplicated.
            return ResultAsync.fromSafePromise(repository.findUserByEmail(profile.email)).andThen((existing) =>
              existing !== undefined
                ? linkAndSignIn(existing, profile.provider, profile.subject, context)
                : repository
                    .createUser({ email: profile.email })
                    .andThen((user) => linkAndSignIn(user, profile.provider, profile.subject, context)),
            );
          }),
        );
      },
    };
  },
} as const;
