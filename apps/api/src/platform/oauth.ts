/**
 * OAuth 2.0 authorization-code sign-in.
 *
 * Google and GitHub are the real providers. The mock implements the same
 * authorization-code exchange against a consent screen this API serves
 * itself, so the whole flow runs on a machine with no provider account and
 * no internet. Only the party asserting "this is who they are" is local.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { DomainError, OAuthProvider } from "@prism/shared";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";

/** Who a provider says the person completing a sign-in is. */
export type OAuthProfile = Readonly<{
  provider: OAuthProvider;
  /** The provider's stable identifier for this user, never their email. */
  subject: string;
  email: string;
}>;

/** One identity provider: where to send a browser, and what to do with the code. */
export type IdentityProvider = Readonly<{
  name: OAuthProvider;
  authorizationUrl: (state: string, redirectUri: string) => string;
  exchange: (code: string, redirectUri: string) => ResultAsync<OAuthProfile, DomainError>;
}>;

/** The providers this instance can complete a sign-in with. */
export type IdentityProviders = Readonly<{
  names: readonly OAuthProvider[];
  find: (name: string) => IdentityProvider | undefined;
  /** True when the built-in stand-in answers instead of a real provider. */
  isMock: boolean;
}>;

export const IdentityProviders = {
  /** `find` answers `undefined` for any name outside `providers`. */
  of: (providers: readonly IdentityProvider[], isMock: boolean): IdentityProviders => {
    // Keyed by plain string: `find` takes whatever arrived in the URL.
    const byName = new Map<string, IdentityProvider>(providers.map((provider) => [provider.name, provider]));

    return {
      names: providers.map((provider) => provider.name),
      find: (name) => byName.get(name),
      isMock,
    };
  },
} as const;

/**
 * The mock's authorization code: the email, and an HMAC over provider and
 * email under the API's own secret. A code this API did not issue does not
 * verify, and a code minted for one provider fails at the other.
 */
export const MockAuthorizationCode = {
  payload: (provider: OAuthProvider, email: string): string => `${provider}:${email}`,

  issue: (provider: OAuthProvider, email: string, secret: Uint8Array): string => {
    const signature = createHmac("sha256", secret)
      .update(MockAuthorizationCode.payload(provider, email))
      .digest("base64url");

    return `${Buffer.from(email, "utf8").toString("base64url")}.${signature}`;
  },

  /** The email a code carries, or `undefined` when the code does not verify. */
  verify: (provider: OAuthProvider, code: string, secret: Uint8Array): string | undefined => {
    const parts = code.split(".");
    const encodedEmail = parts[0];
    const signature = parts[1];
    if (parts.length !== 2 || encodedEmail === undefined || signature === undefined) {
      return undefined;
    }

    const email = Buffer.from(encodedEmail, "base64url").toString("utf8");
    const expected = createHmac("sha256", secret)
      .update(MockAuthorizationCode.payload(provider, email))
      .digest("base64url");
    const provided = Buffer.from(signature, "utf8");
    const computed = Buffer.from(expected, "utf8");

    return provided.length === computed.length && timingSafeEqual(provided, computed)
      ? email
      : undefined;
  },
} as const;

/** The list GitHub's emails endpoint answers with, reduced to one address. */
export const GitHubEmails = {
  isEntry: (entry: unknown): entry is Readonly<{ email: string; primary: boolean; verified: boolean }> =>
    typeof entry === "object" &&
    entry !== null &&
    "email" in entry &&
    typeof entry.email === "string" &&
    "primary" in entry &&
    typeof entry.primary === "boolean" &&
    "verified" in entry &&
    typeof entry.verified === "boolean",

  /**
   * The primary verified address, else the first verified one, lowercased.
   * An unverified address would let anyone who types a victim's address into
   * GitHub link themselves to that account here.
   */
  select: (payload: unknown): string | undefined => {
    if (!Array.isArray(payload)) return undefined;

    const verified = payload.filter(GitHubEmails.isEntry).filter((entry) => entry.verified);
    const chosen = verified.find((entry) => entry.primary) ?? verified[0];

    return chosen === undefined ? undefined : chosen.email.toLowerCase();
  },
} as const;

/** Google's userinfo answer, reduced to the stable id and a verified address. */
export const GoogleUserInfo = {
  /**
   * The profile the answer describes. An answer without a string `sub` fails
   * the exchange. An address that Google does not mark `email_verified: true`
   * is refused, with the address lowercased otherwise.
   */
  read: (payload: unknown): Result<OAuthProfile, DomainError> => {
    if (typeof payload !== "object" || payload === null || !("sub" in payload) || typeof payload.sub !== "string") {
      return err<OAuthProfile, DomainError>({ _tag: "OAuthExchangeFailed" });
    }

    const subject = payload.sub;
    const verified = "email_verified" in payload && payload.email_verified === true;

    // An unverified address would let anyone who registers a victim's address
    // at Google link themselves to that account here.
    return "email" in payload && typeof payload.email === "string" && verified
      ? ok<OAuthProfile, DomainError>({ provider: "google", subject, email: payload.email.toLowerCase() })
      : err<OAuthProfile, DomainError>({ _tag: "OAuthEmailUnavailable" });
  },
} as const;

export const IdentityProvider = {
  exchangeFailed: { _tag: "OAuthExchangeFailed" } as DomainError,

  /** `response.json()` is typed `any`; pinning it keeps the guards below meaningful. */
  fetchJson: (url: string, init: RequestInit): Promise<unknown> =>
    fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }).then(
      (response): Promise<unknown> => response.json(),
    ),

  accessTokenOf: (payload: unknown): ResultAsync<string, DomainError> =>
    typeof payload === "object" &&
    payload !== null &&
    "access_token" in payload &&
    typeof payload.access_token === "string"
      ? okAsync(payload.access_token)
      : errAsync(IdentityProvider.exchangeFailed),

  /** A provider whose consent screen this API serves itself. */
  mock: (name: OAuthProvider, secret: Uint8Array): IdentityProvider => ({
    name,

    authorizationUrl: (state, redirectUri) =>
      `/api/v1/auth/oauth/${name}/consent?${new URLSearchParams({ state, redirect_uri: redirectUri })}`,

    exchange: (code) => {
      const email = MockAuthorizationCode.verify(name, code, secret);

      return email === undefined
        ? errAsync(IdentityProvider.exchangeFailed)
        : okAsync({
            provider: name,
            // Stable per provider and email, like a real provider's subject.
            subject: `mock-${createHmac("sha256", secret)
              .update(`sub:${MockAuthorizationCode.payload(name, email)}`)
              .digest("hex")
              .slice(0, 32)}`,
            email,
          });
    },
  }),

  /** Google, asking for the openid and email scopes. */
  google: (clientId: string, clientSecret: string): IdentityProvider => ({
    name: "google",

    authorizationUrl: (state, redirectUri) =>
      `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: "openid email",
        state,
        prompt: "select_account",
      })}`,

    exchange: (code, redirectUri) =>
      ResultAsync.fromPromise(
        IdentityProvider.fetchJson("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        }),
        () => IdentityProvider.exchangeFailed,
      )
        .andThen(IdentityProvider.accessTokenOf)
        .andThen((accessToken) =>
          ResultAsync.fromPromise(
            IdentityProvider.fetchJson("https://openidconnect.googleapis.com/v1/userinfo", {
              headers: { authorization: `Bearer ${accessToken}` },
            }),
            () => IdentityProvider.exchangeFailed,
          ),
        )
        .andThen(GoogleUserInfo.read),
  }),

  /**
   * GitHub, asking for the `user:email` scope: an account whose address is
   * private has none on the profile, so the address comes from the emails
   * endpoint.
   */
  github: (clientId: string, clientSecret: string): IdentityProvider => ({
    name: "github",

    authorizationUrl: (state, redirectUri) =>
      `https://github.com/login/oauth/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
        allow_signup: "false",
      })}`,

    exchange: (code, redirectUri) =>
      ResultAsync.fromPromise(
        IdentityProvider.fetchJson("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            // Without this GitHub answers form-urlencoded rather than JSON.
            accept: "application/json",
            "user-agent": "prism",
          },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
          }),
        }),
        () => IdentityProvider.exchangeFailed,
      )
        .andThen(IdentityProvider.accessTokenOf)
        .andThen((accessToken) => {
          const headers = {
            authorization: `Bearer ${accessToken}`,
            accept: "application/vnd.github+json",
            "user-agent": "prism",
          };

          return ResultAsync.fromPromise(
            Promise.all([
              IdentityProvider.fetchJson("https://api.github.com/user", { headers }),
              IdentityProvider.fetchJson("https://api.github.com/user/emails", { headers }),
            ]),
            () => IdentityProvider.exchangeFailed,
          );
        })
        .andThen(([user, emails]) => {
          const email = GitHubEmails.select(emails);

          if (
            typeof user !== "object" ||
            user === null ||
            !("id" in user) ||
            typeof user.id !== "number"
          ) {
            return errAsync<OAuthProfile, DomainError>(IdentityProvider.exchangeFailed);
          }
          if (email === undefined) {
            return errAsync<OAuthProfile, DomainError>({ _tag: "OAuthEmailUnavailable" });
          }

          // The numeric id, not the login: a username can be re-registered by
          // somebody else, the id cannot.
          return okAsync<OAuthProfile, DomainError>({
            provider: "github",
            subject: String(user.id),
            email,
          });
        }),
  }),
} as const;
