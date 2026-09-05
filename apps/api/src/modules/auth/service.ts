/**
 * Authentication domain logic.
 *
 * Everything this file needs arrives as an argument — clock, hasher, tokens,
 * mailer, captcha, repository. There is no import of a concrete adapter, which
 * is what lets the unit tests run the real logic against fakes.
 *
 * Every operation returns `Result<T, DomainError>`. There is no `throw` here.
 */

import type {
  AccessGrant,
  AvailableProviders,
  DomainError,
  LoginOutcome,
  TwoFactorChallenge,
  SessionUser,
  TwoFactorSetup,
  UserRole,
} from "@prism/shared";
import { Option } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../../platform/clock.ts";
import { secondsFromNow } from "../../platform/clock.ts";
import type { CaptchaVerifier } from "../../platform/captcha.ts";
import type { Hasher } from "../../platform/hasher.ts";
import type { Mailer } from "../../platform/mailer.ts";
import type { OAuthRegistry } from "../../platform/oauth.ts";
import type { TokenService } from "../../platform/tokens.ts";
import { createOpaqueToken, digestToken } from "../../platform/tokens.ts";
import type { TotpService } from "../../platform/totp.ts";
import { passwordResetEmail } from "./emails.ts";
import type { AuthRepository, UserRecord } from "./repository.ts";
import { randomUUID } from "node:crypto";

/** Every port the auth module works through. No adapter is reached for directly. */
export type AuthDependencies = Readonly<{
  repository: AuthRepository;
  clock: Clock;
  hasher: Hasher;
  tokens: TokenService;
  totp: TotpService;
  mailer: Mailer;
  captcha: CaptchaVerifier;
  oauth: OAuthRegistry;
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
  refreshToken: string;
  refreshExpiresAt: Date;
}>;

/**
 * The record as it stands once a provider has just been linked.
 *
 * `providers` is read with the user, so a record loaded before the link is a
 * provider short — which is exactly the session being issued on a first
 * sign-in. Re-reading the row would work; adding the provider that was just
 * linked is cheaper and lands on the same answer, in the same alphabetical
 * order the SQL produces.
 */
export const withProvider = (user: UserRecord, provider: string): UserRecord => ({
  ...user,
  providers: [...new Set([...user.providers, provider])].sort(),
});

/** An account as the wire reports it. Neither secret leaves in it. */
export const toSessionUser = (user: UserRecord): SessionUser => ({
  id: user.id,
  email: user.email,
  role: user.role,
  twoFactorEnabled: Option.isSome(user.totpEnabledAt),
  hasPassword: Option.isSome(user.passwordHash),
  providers: user.providers,
});

/** Everything an account can do, with every failure a `DomainError`. */
export type AuthService = Readonly<{
  register: (input: {
    email: string;
    password: string;
    captchaToken: string;
    context: RequestContext;
  }) => ResultAsync<IssuedSession, DomainError>;

  login: (input: {
    email: string;
    password: string;
    context: RequestContext;
  }) => ResultAsync<LoginOutcome | IssuedSession, DomainError>;

  completeTwoFactorLogin: (input: {
    challengeToken: string;
    code: string;
    context: RequestContext;
  }) => ResultAsync<IssuedSession, DomainError>;

  refresh: (
    presentedToken: string,
  ) => ResultAsync<IssuedSession, DomainError>;

  logout: (sessionId: string) => ResultAsync<void, DomainError>;

  currentUser: (userId: string) => ResultAsync<SessionUser, DomainError>;

  requestPasswordReset: (email: string) => ResultAsync<void, DomainError>;

  changePassword: (input: {
    userId: string;
    currentPassword: Option<string>;
    password: string;
  }) => ResultAsync<SessionUser, DomainError>;

  resetPassword: (input: {
    token: string;
    password: string;
  }) => ResultAsync<void, DomainError>;

  beginTwoFactorSetup: (userId: string) => ResultAsync<TwoFactorSetup, DomainError>;
  enableTwoFactor: (input: {
    userId: string;
    code: string;
  }) => ResultAsync<SessionUser, DomainError>;
  disableTwoFactor: (input: {
    userId: string;
    code: string;
  }) => ResultAsync<SessionUser, DomainError>;

  availableProviders: () => AvailableProviders;
  oauthAuthorizationUrl: (input: {
    provider: string;
    redirectUri: string;
  }) => ResultAsync<Readonly<{ url: string; state: string }>, DomainError>;
  /** A challenge rather than a session when the account has a second factor. */
  completeOAuthLogin: (input: {
    provider: string;
    code: string;
    redirectUri: string;
    context: RequestContext;
  }) => ResultAsync<TwoFactorChallenge | IssuedSession, DomainError>;
}>;

/** The auth module over the ports it is given. */
export const createAuthService = (deps: AuthDependencies): AuthService => {
  const {
    repository,
    clock,
    hasher,
    tokens,
    totp,
    mailer,
    captcha,
    oauth,
  } = deps;

  /**
   * Mints a session: one database row, one opaque refresh token, one JWT.
   * Used by every path that ends in "the user is now signed in".
   */
  const issueSession = (
    user: UserRecord,
    context: RequestContext,
  ): ResultAsync<IssuedSession, DomainError> => {
    const refresh = createOpaqueToken();
    const refreshExpiresAt = secondsFromNow(clock, deps.refreshTtlSeconds);

    return ResultAsync.fromSafePromise(
      repository.createSession({
        userId: user.id,
        expiresAt: refreshExpiresAt,
        userAgent: context.userAgent,
        ipAddress: context.ipAddress,
        refreshTokenDigest: refresh.digest,
        refreshExpiresAt,
      }),
    ).andThen((session) =>
      tokens
        .issueAccessToken({
          subject: user.id,
          sessionId: session.id,
          role: user.role,
          tokenId: randomUUID(),
        })
        .map((accessToken) => ({
          grant: {
            accessToken,
            expiresInSeconds: deps.accessTtlSeconds,
            user: toSessionUser(user),
          },
          refreshToken: refresh.plaintext,
          refreshExpiresAt,
        })),
    );
  };

  /**
   * The end of a provider sign-in.
   *
   * A provider proves who owns the third-party account; it says nothing about
   * the second factor this account asked for. Skipping TOTP here would make
   * the account only as strong as the weakest thing linked to it — and since
   * a provider reporting a matching verified address links itself
   * automatically, that is not a bar the owner controls.
   */
  const signInOAuth = (
    user: UserRecord,
    context: RequestContext,
  ): ResultAsync<TwoFactorChallenge | IssuedSession, DomainError> =>
    Option.isSome(user.totpEnabledAt)
      ? tokens
          .issueTwoFactorChallenge({ subject: user.id })
          .map((challengeToken): TwoFactorChallenge => ({
            status: "two_factor_required",
            challengeToken,
          }))
      : issueSession(user, context);

  const issueAccessForRotatedSession = (
    userId: string,
    sessionId: string,
    role: UserRole,
    refreshToken: string,
    refreshExpiresAt: Date,
  ): ResultAsync<IssuedSession, DomainError> =>
    ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) =>
      Option.isNone(found)
        ? errAsync<IssuedSession, DomainError>({ _tag: "RefreshTokenInvalid" })
        : tokens
            .issueAccessToken({
              subject: userId,
              sessionId,
              role,
              tokenId: randomUUID(),
            })
            .map((accessToken) => ({
              grant: {
                accessToken,
                expiresInSeconds: deps.accessTtlSeconds,
                user: toSessionUser(found.value),
              },
              refreshToken,
              refreshExpiresAt,
            })),
    );

  return {
    register: ({ email, password, captchaToken, context }) =>
      captcha
        .verify(captchaToken, context.ipAddress)
        .andThen(() => ResultAsync.fromSafePromise(hasher.hash(password)))
        .andThen((passwordHash) =>
          repository.createUser({ email, passwordHash: Option.some(passwordHash) }),
        )
        .andThen((user) => issueSession(user, context)),

    login: ({ email, password, context }) =>
      ResultAsync.fromSafePromise(repository.findUserByEmail(email)).andThen(
        (found) => {
          if (Option.isNone(found)) {
            // Spend the same CPU as a real verification, so response time does
            // not reveal whether the address is registered.
            return ResultAsync.fromSafePromise(hasher.fakeVerify()).andThen(() =>
              errAsync<LoginOutcome | IssuedSession, DomainError>({
                _tag: "InvalidCredentials",
              }),
            );
          }

          const user = found.value;

          if (Option.isNone(user.passwordHash)) {
            return ResultAsync.fromSafePromise(hasher.fakeVerify()).andThen(() =>
              errAsync<LoginOutcome | IssuedSession, DomainError>({
                _tag: "PasswordLoginUnavailable",
              }),
            );
          }

          const storedHash = user.passwordHash.value;

          return ResultAsync.fromSafePromise(
            hasher.verify(storedHash, password),
          ).andThen((matches) => {
            if (!matches) {
              return errAsync<LoginOutcome | IssuedSession, DomainError>({
                _tag: "InvalidCredentials",
              });
            }

            // The password was right, but it is not sufficient on its own.
            if (Option.isSome(user.totpEnabledAt)) {
              return tokens
                .issueTwoFactorChallenge({ subject: user.id })
                .map(
                  (challengeToken): LoginOutcome => ({
                    status: "two_factor_required",
                    challengeToken,
                  }),
                );
            }

            return issueSession(user, context);
          });
        },
      ),

    completeTwoFactorLogin: ({ challengeToken, code, context }) =>
      tokens
        .verifyTwoFactorChallenge(challengeToken)
        .andThen((claims) =>
          ResultAsync.fromSafePromise(repository.findUserById(claims.subject)),
        )
        .andThen((found) =>
          Option.isNone(found)
            ? errAsync<UserRecord, DomainError>({ _tag: "TwoFactorCodeInvalid" })
            : okAsync<UserRecord, DomainError>(found.value),
        )
        .andThen((user) => {
          if (Option.isNone(user.totpSecret) || Option.isNone(user.totpEnabledAt)) {
            return errAsync<IssuedSession, DomainError>({
              _tag: "TwoFactorNotEnabled",
            });
          }

          return totp.verify(user.totpSecret.value, code)
            ? issueSession(user, context)
            : errAsync<IssuedSession, DomainError>({
                _tag: "TwoFactorCodeInvalid",
              });
        }),

    refresh: (presentedToken) => {
      const replacement = createOpaqueToken();
      const now = clock.now();
      const replacementExpiresAt = secondsFromNow(clock, deps.refreshTtlSeconds);

      return ResultAsync.fromSafePromise(
        repository.rotateRefreshToken({
          presentedDigest: digestToken(presentedToken),
          replacementDigest: replacement.digest,
          now,
          replacementExpiresAt,
        }),
      ).andThen((outcome) => {
        switch (outcome._tag) {
          case "Rotated":
            return issueAccessForRotatedSession(
              outcome.userId,
              outcome.sessionId,
              outcome.role,
              replacement.plaintext,
              replacementExpiresAt,
            );
          case "Replayed":
            return errAsync<IssuedSession, DomainError>({
              _tag: "RefreshTokenReused",
            });
          case "SessionEnded":
            return errAsync<IssuedSession, DomainError>({ _tag: "SessionRevoked" });
          case "Unknown":
            return errAsync<IssuedSession, DomainError>({
              _tag: "RefreshTokenInvalid",
            });
        }
      });
    },

    logout: (sessionId) =>
      ResultAsync.fromSafePromise(repository.revokeSession(sessionId, "logout")),

    currentUser: (userId) =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) =>
        Option.isNone(found)
          ? errAsync<SessionUser, DomainError>({ _tag: "Unauthenticated" })
          : okAsync<SessionUser, DomainError>(toSessionUser(found.value)),
      ),

    /**
     * Always succeeds, whether or not the address exists. Any other behavior
     * turns this endpoint into a "does this person shop here" oracle.
     */
    requestPasswordReset: (email) =>
      ResultAsync.fromSafePromise(
        repository.findUserByEmail(email).then(async (found) => {
          if (Option.isNone(found)) return;

          const reset = createOpaqueToken();
          const expiresAt = secondsFromNow(clock, deps.passwordResetTtlSeconds);

          await repository.createPasswordResetToken({
            userId: found.value.id,
            digest: reset.digest,
            expiresAt,
          });

          await mailer.send(
            passwordResetEmail({
              to: found.value.email,
              resetUrl: `${deps.webOrigin}/reset-password?token=${encodeURIComponent(reset.plaintext)}`,
              expiresInMinutes: Math.round(deps.passwordResetTtlSeconds / 60),
            }),
          );
        }),
      ),

    /**
     * Changes the password, or sets the first one.
     *
     * Which of the two it is depends on the account, not on what the client
     * sent: an account with a password must prove it knows the old one, so a
     * stolen session cannot lock the owner out. An account created through a
     * provider has nothing to prove, and the session is the authorization.
     *
     * Sessions elsewhere are left alone. Whoever did this already knew the
     * current password or held the provider; the reset-by-email flow is the
     * one that assumes compromise, and that one does revoke.
     */
    changePassword: ({ userId, currentPassword, password }) =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) => {
        if (Option.isNone(found)) {
          return errAsync<SessionUser, DomainError>({ _tag: "Unauthenticated" });
        }

        const user = found.value;

        const confirmed: ResultAsync<void, DomainError> = Option.isNone(
          user.passwordHash,
        )
          ? okAsync(undefined)
          : Option.isNone(currentPassword)
            ? errAsync<void, DomainError>({ _tag: "InvalidCredentials" })
            : ResultAsync.fromSafePromise(
                hasher.verify(user.passwordHash.value, currentPassword.value),
              ).andThen((matches) =>
                matches
                  ? okAsync<void, DomainError>(undefined)
                  : errAsync<void, DomainError>({ _tag: "InvalidCredentials" }),
              );

        return confirmed.andThen(() =>
          ResultAsync.fromSafePromise(
            hasher.hash(password).then(async (passwordHash) => {
              await repository.setPasswordHash(userId, passwordHash);
              return toSessionUser({
                ...user,
                passwordHash: Option.some(passwordHash),
              });
            }),
          ),
        );
      }),

    resetPassword: ({ token, password }) =>
      ResultAsync.fromSafePromise(
        repository.consumePasswordResetToken(digestToken(token), clock.now()),
      ).andThen((found) =>
        Option.isNone(found)
          ? errAsync<void, DomainError>({ _tag: "ResetTokenInvalid" })
          : ResultAsync.fromSafePromise(
              hasher.hash(password).then(async (passwordHash) => {
                await repository.setPasswordHash(found.value, passwordHash);
                // Whoever knew the old password no longer has a way in.
                await repository.revokeSessionsForUser(found.value, "password_reset");
              }),
            ),
      ),

    beginTwoFactorSetup: (userId) =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) => {
        if (Option.isNone(found)) {
          return errAsync<TwoFactorSetup, DomainError>({ _tag: "Unauthenticated" });
        }
        if (Option.isSome(found.value.totpEnabledAt)) {
          return errAsync<TwoFactorSetup, DomainError>({
            _tag: "TwoFactorAlreadyEnabled",
          });
        }

        const secret = totp.generateSecret();
        const uri = totp.keyUri(found.value.email, secret);

        return ResultAsync.fromSafePromise(
          repository
            .setTotpSecret(userId, secret)
            .then(() => totp.qrCodeSvg(uri))
            .then((qrCodeSvg): TwoFactorSetup => ({ uri, qrCodeSvg })),
        );
      }),

    enableTwoFactor: ({ userId, code }) =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) => {
        if (Option.isNone(found)) {
          return errAsync<SessionUser, DomainError>({ _tag: "Unauthenticated" });
        }

        const user = found.value;

        if (Option.isSome(user.totpEnabledAt)) {
          return errAsync<SessionUser, DomainError>({
            _tag: "TwoFactorAlreadyEnabled",
          });
        }
        if (Option.isNone(user.totpSecret)) {
          return errAsync<SessionUser, DomainError>({
            _tag: "TwoFactorNotInitialized",
          });
        }
        // Proving one live code confirms the secret actually reached the phone.
        if (!totp.verify(user.totpSecret.value, code)) {
          return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorCodeInvalid" });
        }

        const enabledAt = clock.now();

        return ResultAsync.fromSafePromise(
          repository
            .enableTotp(userId, enabledAt)
            .then(() =>
              toSessionUser({ ...user, totpEnabledAt: Option.some(enabledAt) }),
            ),
        );
      }),

    disableTwoFactor: ({ userId, code }) =>
      ResultAsync.fromSafePromise(repository.findUserById(userId)).andThen((found) => {
        if (Option.isNone(found)) {
          return errAsync<SessionUser, DomainError>({ _tag: "Unauthenticated" });
        }

        const user = found.value;

        if (Option.isNone(user.totpEnabledAt) || Option.isNone(user.totpSecret)) {
          return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorNotEnabled" });
        }
        // Turning the second factor off is itself a sensitive action.
        if (!totp.verify(user.totpSecret.value, code)) {
          return errAsync<SessionUser, DomainError>({ _tag: "TwoFactorCodeInvalid" });
        }

        return ResultAsync.fromSafePromise(
          repository
            .disableTotp(userId)
            .then(() =>
              toSessionUser({
                ...user,
                totpSecret: Option.none,
                totpEnabledAt: Option.none,
              }),
            ),
        );
      }),

    availableProviders: () => ({ providers: oauth.names, mock: oauth.isMock }),

    oauthAuthorizationUrl: ({ provider, redirectUri }) => {
      const chosen = oauth.find(provider);

      if (Option.isNone(chosen)) {
        return errAsync<{ url: string; state: string }, DomainError>({
          _tag: "OAuthProviderUnknown",
        });
      }

      // Signed into a cookie by the route, then compared on the way back —
      // an authorization response this app did not initiate is rejected.
      const state = createOpaqueToken().plaintext;

      return okAsync({
        url: chosen.value.authorizationUrl(state, redirectUri),
        state,
      });
    },

    completeOAuthLogin: ({ provider, code, redirectUri, context }) => {
      const chosen = oauth.find(provider);

      if (Option.isNone(chosen)) {
        return errAsync<IssuedSession, DomainError>({
          _tag: "OAuthProviderUnknown",
        });
      }

      return chosen.value.exchange(code, redirectUri).andThen((profile) =>
        ResultAsync.fromSafePromise(
          repository.findUserByOAuthIdentity(profile.provider, profile.subject),
        ).andThen((linked) => {
          if (Option.isSome(linked)) return signInOAuth(linked.value, context);

          // First sign-in with this provider. If the address already has an
          // account, link to it rather than creating a duplicate person.
          return ResultAsync.fromSafePromise(
            repository.findUserByEmail(profile.email),
          ).andThen((existing) =>
            Option.isSome(existing)
              ? ResultAsync.fromSafePromise(
                  repository
                    .linkOAuthIdentity({
                      userId: existing.value.id,
                      provider: profile.provider,
                      subject: profile.subject,
                    })
                    .then(() => withProvider(existing.value, profile.provider)),
                ).andThen((user) => signInOAuth(user, context))
              : repository
                  .createUser({ email: profile.email, passwordHash: Option.none })
                  .andThen((user) =>
                    ResultAsync.fromSafePromise(
                      repository
                        .linkOAuthIdentity({
                          userId: user.id,
                          provider: profile.provider,
                          subject: profile.subject,
                        })
                        .then(() => withProvider(user, profile.provider)),
                    ),
                  )
                  .andThen((user) => signInOAuth(user, context)),
          );
        }),
      );
    },
  };
};
