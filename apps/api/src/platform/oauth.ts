/**
 * OAuth 2.0 authorization-code sign-in.
 *
 * Two adapters behind one port. `google` is the real thing. `mock` implements
 * the same authorization-code exchange against a consent screen this API serves
 * itself, so the flow — redirect, state check, code exchange, profile lookup,
 * account link — is genuinely exercised on a machine with no Google account and
 * no internet. Only the identity provider is substituted.
 */

import type { DomainError, OAuthProviderName } from "@prism/shared";
import { Option } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Who a provider says the person completing a sign-in is. */
export type OAuthProfile = Readonly<{
  provider: OAuthProviderName;
  /** The provider's stable identifier for this user — never their email. */
  subject: string;
  email: string;
}>;

/** One identity provider: where to send a browser, and what to do with the code. */
export type OAuthProvider = Readonly<{
  name: OAuthProviderName;
  authorizationUrl: (state: string, redirectUri: string) => string;
  exchange: (
    code: string,
    redirectUri: string,
  ) => ResultAsync<OAuthProfile, DomainError>;
}>;

/**
 * The set of providers this instance can actually complete a sign-in with.
 * Built once at the composition root from whatever credentials are configured.
 */
export type OAuthRegistry = Readonly<{
  names: readonly OAuthProviderName[];
  find: (name: string) => Option<OAuthProvider>;
  isMock: boolean;
}>;

/** The providers this instance can sign in with. `find` answers `None` for the rest. */
export const createOAuthRegistry = (
  providers: readonly OAuthProvider[],
  isMock: boolean,
): OAuthRegistry => {
  // Keyed by plain string: `find` is called with whatever arrived in the URL,
  // which is not yet known to be a provider name.
  const byName = new Map<string, OAuthProvider>(
    providers.map((provider) => [provider.name, provider]),
  );

  return {
    names: providers.map((provider) => provider.name),
    find: (name) => Option.fromNullable(byName.get(name)),
    isMock,
  };
};

const exchangeFailed: DomainError = { _tag: "OAuthExchangeFailed" };

/* ---------------------------------------------------------------- the mock */

/**
 * The mock's "authorization code" is `email.hmac`, signed with the JWT secret.
 * That keeps the consent screen from being an open redirect into any account:
 * a code this API did not issue does not verify.
 *
 * The provider name is part of what gets signed, so a code minted for GitHub
 * cannot be presented at the Google callback — the same isolation two real
 * providers have by virtue of not sharing a client secret.
 */
const mockPayload = (provider: OAuthProviderName, email: string): string =>
  `${provider}:${email}`;

/**
 * An authorization code for the built-in consent screen.
 *
 * Signed with the API's own secret, so a code minted for one provider cannot
 * be redeemed at another.
 */
export const issueMockAuthorizationCode = (
  provider: OAuthProviderName,
  email: string,
  secret: Uint8Array,
): string => {
  const signature = createHmac("sha256", secret)
    .update(mockPayload(provider, email))
    .digest("base64url");

  return `${Buffer.from(email, "utf8").toString("base64url")}.${signature}`;
};

const verifyMockCode = (
  provider: OAuthProviderName,
  code: string,
  secret: Uint8Array,
): Option<string> => {
  const parts = code.split(".");
  if (parts.length !== 2) return Option.none;

  const [encodedEmail, signature] = parts;
  if (encodedEmail === undefined || signature === undefined) return Option.none;

  const email = Buffer.from(encodedEmail, "base64url").toString("utf8");
  const expected = createHmac("sha256", secret)
    .update(mockPayload(provider, email))
    .digest("base64url");

  const provided = Buffer.from(signature, "utf8");
  const computed = Buffer.from(expected, "utf8");

  if (provided.length !== computed.length) return Option.none;

  return timingSafeEqual(provided, computed) ? Option.some(email) : Option.none;
};

/** A provider whose consent screen this API serves itself. */
export const createMockOAuthProvider = (
  provider: OAuthProviderName,
  secret: Uint8Array,
): OAuthProvider => ({
  name: provider,

  authorizationUrl: (state, redirectUri) => {
    const params = new URLSearchParams({ state, redirect_uri: redirectUri });
    return `/api/v1/auth/oauth/${provider}/consent?${params.toString()}`;
  },

  exchange: (code) => {
    const email = verifyMockCode(provider, code, secret);

    return Option.isNone(email)
      ? errAsync(exchangeFailed)
      : okAsync({
          provider,
          // Stable per provider and email, mirroring a real provider's
          // immutable subject. The same address on Google and GitHub is two
          // identities, exactly as it would be in reality.
          subject: `mock-${createHmac("sha256", secret)
            .update(`sub:${mockPayload(provider, email.value)}`)
            .digest("hex")
            .slice(0, 32)}`,
          email: email.value,
        });
  },
});

/* --------------------------------------------------------------- the real */

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

type GoogleProfile = Readonly<{ sub: string; email: string; email_verified: boolean }>;

const isGoogleProfile = (payload: unknown): payload is GoogleProfile =>
  typeof payload === "object" &&
  payload !== null &&
  "sub" in payload &&
  typeof payload.sub === "string" &&
  "email" in payload &&
  typeof payload.email === "string";

const isAccessTokenPayload = (
  payload: unknown,
): payload is Readonly<{ access_token: string }> =>
  typeof payload === "object" &&
  payload !== null &&
  "access_token" in payload &&
  typeof payload.access_token === "string";

/** Google, asking for the profile and email scopes. */
export const createGoogleOAuthProvider = (
  clientId: string,
  clientSecret: string,
): OAuthProvider => ({
  name: "google",

  authorizationUrl: (state, redirectUri) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email",
      state,
      prompt: "select_account",
    });

    return `${AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  },

  exchange: (code, redirectUri) =>
    ResultAsync.fromPromise(
      fetch(TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(10_000),
      }).then((response) => response.json()),
      () => exchangeFailed,
    )
      .andThen((payload) =>
        isAccessTokenPayload(payload)
          ? okAsync(payload.access_token)
          : errAsync(exchangeFailed),
      )
      .andThen((accessToken) =>
        ResultAsync.fromPromise(
          fetch(USERINFO_ENDPOINT, {
            headers: { authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10_000),
          }).then((response) => response.json()),
          () => exchangeFailed,
        ),
      )
      .andThen((payload) =>
        isGoogleProfile(payload)
          ? okAsync<OAuthProfile, DomainError>({
              provider: "google",
              subject: payload.sub,
              email: payload.email.toLowerCase(),
            })
          : errAsync<OAuthProfile, DomainError>(exchangeFailed),
      ),
});

/* --------------------------------------------------------------- GitHub */

const GITHUB_AUTHORIZATION_ENDPOINT = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const GITHUB_USER_ENDPOINT = "https://api.github.com/user";
const GITHUB_EMAILS_ENDPOINT = "https://api.github.com/user/emails";

/** GitHub rejects API calls without one. */
const GITHUB_USER_AGENT = "prism";

type GitHubUser = Readonly<{ id: number; login: string }>;

type GitHubEmail = Readonly<{
  email: string;
  primary: boolean;
  verified: boolean;
}>;

const isGitHubUser = (payload: unknown): payload is GitHubUser =>
  typeof payload === "object" &&
  payload !== null &&
  "id" in payload &&
  typeof payload.id === "number" &&
  "login" in payload &&
  typeof payload.login === "string";

const isGitHubEmail = (entry: unknown): entry is GitHubEmail =>
  typeof entry === "object" &&
  entry !== null &&
  "email" in entry &&
  typeof entry.email === "string" &&
  "primary" in entry &&
  typeof entry.primary === "boolean" &&
  "verified" in entry &&
  typeof entry.verified === "boolean";

/**
 * Picks the address to identify the account by.
 *
 * Only verified addresses are eligible — an unverified one would let anybody
 * who can type a victim's address into GitHub link themselves to that account
 * here. Primary wins; otherwise the first verified address, so a user who
 * never set a primary can still sign in.
 *
 * Exported because the choice is the interesting part and it is pure.
 */
export const selectGitHubEmail = (payload: unknown): Option<string> => {
  if (!Array.isArray(payload)) return Option.none;

  const verified = payload.filter(isGitHubEmail).filter((entry) => entry.verified);
  const primary = verified.find((entry) => entry.primary);

  return Option.map((entry: GitHubEmail) => entry.email.toLowerCase())(
    Option.fromNullable(primary ?? verified[0]),
  );
};

/**
 * GitHub, asking for the user's email scope.
 *
 * An account whose address is private has none on the profile, so the address
 * is read from the emails endpoint, preferring the primary verified one.
 */
export const createGitHubOAuthProvider = (
  clientId: string,
  clientSecret: string,
): OAuthProvider => ({
  name: "github",

  authorizationUrl: (state, redirectUri) => {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      // `user:email` is what makes the private-email case work; without it the
      // emails endpoint returns 403 and accounts with a hidden address cannot
      // sign in at all.
      scope: "read:user user:email",
      state,
      allow_signup: "false",
    });

    return `${GITHUB_AUTHORIZATION_ENDPOINT}?${params.toString()}`;
  },

  exchange: (code, redirectUri) =>
    ResultAsync.fromPromise(
      fetch(GITHUB_TOKEN_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          // Without this GitHub answers form-urlencoded rather than JSON, and
          // `response.json()` throws on a perfectly successful exchange.
          accept: "application/json",
          "user-agent": GITHUB_USER_AGENT,
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
        }),
        signal: AbortSignal.timeout(10_000),
      }).then((response) => response.json()),
      () => exchangeFailed,
    )
      .andThen((payload) =>
        isAccessTokenPayload(payload)
          ? okAsync(payload.access_token)
          : errAsync(exchangeFailed),
      )
      .andThen((accessToken) => {
        const headers = {
          authorization: `Bearer ${accessToken}`,
          accept: "application/vnd.github+json",
          "user-agent": GITHUB_USER_AGENT,
        };

        // `response.json()` is typed `any`; pinning it to `unknown` keeps the
        // type guards below doing real work instead of being erased.
        const fetchJson = (url: string): Promise<unknown> =>
          fetch(url, { headers, signal: AbortSignal.timeout(10_000) }).then(
            (response): Promise<unknown> => response.json(),
          );

        // The profile carries the immutable id; the address has to be fetched
        // separately, because /user returns email: null when the user has
        // chosen to keep it private — which is the default for many accounts.
        //
        // Promise.all rather than ResultAsync.combine: the two requests still
        // run concurrently, and a tuple of promises infers as a tuple, where
        // combine over a readonly tuple collapses its element type to never.
        return ResultAsync.fromPromise(
          Promise.all([
            fetchJson(GITHUB_USER_ENDPOINT),
            fetchJson(GITHUB_EMAILS_ENDPOINT),
          ]),
          () => exchangeFailed,
        );
      })
      .andThen(([user, emails]) => {
        if (!isGitHubUser(user)) {
          return errAsync<OAuthProfile, DomainError>(exchangeFailed);
        }

        const email = selectGitHubEmail(emails);

        if (Option.isNone(email)) {
          return errAsync<OAuthProfile, DomainError>({
            _tag: "OAuthEmailUnavailable",
          });
        }

        return okAsync<OAuthProfile, DomainError>({
          provider: "github",
          // The numeric id, not the login: a username can be changed and
          // re-registered by somebody else, the id cannot.
          subject: String(user.id),
          email: email.value,
        });
      }),
});
