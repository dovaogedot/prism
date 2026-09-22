/**
 * OAuth 2.0 authorization-code sign-in.
 *
 * Google and GitHub are the real providers. The mock implements the same
 * authorization-code exchange against a consent screen this API serves
 * itself, so the whole flow runs on a machine with no provider account and
 * no internet. Only the party asserting "this is who they are" is local.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Email, type DomainError, type OAuthProvider } from "@prism/shared";
import { err, errAsync, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import { z } from "zod";

/** A provider's own stable identifier for a person, never their email. */
export type ProviderSubject = z.infer<typeof ProviderSubject.schema>;
export const ProviderSubject = {
  schema: z.string().min(1).brand<"ProviderSubject">(),
} as const;

/** What ties a provider's callback to the browser that started the sign-in. */
export type OAuthState = z.infer<typeof OAuthState.schema>;
export const OAuthState = {
  schema: z.string().min(1).max(512).brand<"OAuthState">(),
} as const;

/** The one-time code a provider sends back, to be exchanged for a profile. */
export type AuthorizationCode = z.infer<typeof AuthorizationCode.schema>;
export const AuthorizationCode = {
  schema: z.string().min(1).max(2048).brand<"AuthorizationCode">(),
} as const;

/** Where a provider sends the browser back to: this API's own callback route. */
export type RedirectUri = z.infer<typeof RedirectUri.schema>;
export const RedirectUri = {
  schema: z.url().max(2048).brand<"RedirectUri">(),
} as const;

/** Who a provider says the person completing a sign-in is. */
export type OAuthProfile = Readonly<{
  provider: OAuthProvider;
  subject: ProviderSubject;
  email: Email;
}>;

/** One identity provider: where to send a browser, and what to do with the code. */
export type IdentityProvider = Readonly<{
  name: OAuthProvider;
  authorizationUrl: (state: OAuthState, redirectUri: RedirectUri) => string;
  exchange: (code: AuthorizationCode, redirectUri: RedirectUri) => ResultAsync<OAuthProfile, DomainError>;
}>;

/** The providers this instance can complete a sign-in with. */
export type IdentityProviders = Readonly<{
  names: readonly OAuthProvider[];
  /** `undefined` for a provider this instance has no credentials for. */
  find: (name: OAuthProvider) => IdentityProvider | undefined;
  /** True when the built-in stand-in answers instead of a real provider. */
  isMock: boolean;
}>;

export const IdentityProviders = {
  of: (providers: readonly IdentityProvider[], isMock: boolean): IdentityProviders => {
    const byName = new Map<OAuthProvider, IdentityProvider>(providers.map((provider) => [provider.name, provider]));

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
  payload: (provider: OAuthProvider, email: Email): string => `${provider}:${email}`,

  issue: (provider: OAuthProvider, email: Email, secret: Uint8Array): AuthorizationCode => {
    const signature = createHmac("sha256", secret)
      .update(MockAuthorizationCode.payload(provider, email))
      .digest("base64url");

    return AuthorizationCode.schema.parse(`${Buffer.from(email, "utf8").toString("base64url")}.${signature}`);
  },

  /** The email a code carries, or `undefined` when the code does not verify. */
  verify: (provider: OAuthProvider, code: AuthorizationCode, secret: Uint8Array): Email | undefined => {
    const parts = code.split(".");
    const encodedEmail = parts[0];
    const signature = parts[1];
    if (parts.length !== 2 || encodedEmail === undefined || signature === undefined) {
      return undefined;
    }

    const email = Email.schema.safeParse(Buffer.from(encodedEmail, "base64url").toString("utf8"));
    if (!email.success) return undefined;

    const expected = createHmac("sha256", secret)
      .update(MockAuthorizationCode.payload(provider, email.data))
      .digest("base64url");
    const provided = Buffer.from(signature, "utf8");
    const computed = Buffer.from(expected, "utf8");

    return provided.length === computed.length && timingSafeEqual(provided, computed)
      ? email.data
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
   * The primary verified address, else the first verified one. An unverified
   * address would let anyone who types a victim's address into GitHub link
   * themselves to that account here.
   */
  select: (payload: unknown): Email | undefined => {
    if (!Array.isArray(payload)) return undefined;

    const verified = payload.filter(GitHubEmails.isEntry).filter((entry) => entry.verified);
    const chosen = verified.find((entry) => entry.primary) ?? verified[0];
    const email = Email.schema.safeParse(chosen?.email);

    return email.success ? email.data : undefined;
  },
} as const;

/** Google's userinfo answer, reduced to the stable id and a verified address. */
export const GoogleUserInfo = {
  /**
   * The profile the answer describes. An answer without a usable `sub` fails
   * the exchange. An address that Google does not mark `email_verified: true`,
   * or that is not an address, is refused.
   */
  read: (payload: unknown): Result<OAuthProfile, DomainError> => {
    if (typeof payload !== "object" || payload === null) {
      return err<OAuthProfile, DomainError>({ _tag: "OAuthExchangeFailed" });
    }

    const subject = ProviderSubject.schema.safeParse("sub" in payload ? payload.sub : undefined);
    if (!subject.success) return err<OAuthProfile, DomainError>({ _tag: "OAuthExchangeFailed" });

    const verified = "email_verified" in payload && payload.email_verified === true;
    const email = Email.schema.safeParse("email" in payload ? payload.email : undefined);

    // An unverified address would let anyone who registers a victim's address
    // at Google link themselves to that account here.
    return verified && email.success
      ? ok<OAuthProfile, DomainError>({ provider: "google", subject: subject.data, email: email.data })
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
            subject: ProviderSubject.schema.parse(
              `mock-${createHmac("sha256", secret)
                .update(`sub:${MockAuthorizationCode.payload(name, email)}`)
                .digest("hex")
                .slice(0, 32)}`,
            ),
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
            subject: ProviderSubject.schema.parse(String(user.id)),
            email,
          });
        }),
  }),
} as const;
