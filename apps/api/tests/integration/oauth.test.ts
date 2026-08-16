/**
 * The third-party sign-in flow end to end, for every provider, against the
 * offline stand-in — the redirect, the state check, the code exchange, the
 * account link and the identity separation are all the real code paths.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OAUTH_PROVIDERS } from "@prism/shared";
import { issueMockAuthorizationCode } from "../../src/platform/oauth.ts";
import {
  cookieValue,
  jsonOf,
  registerUser,
  startHarness,
  VALID_PASSWORD,
  type Harness,
} from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
});

const OAUTH_STATE_COOKIE = "hue_oauth_state";

/** Walks a provider's flow from the button to a usable refresh cookie. */
const signInWith = async (provider: string, email: string) => {
  const begin = await harness.app.inject({
    method: "GET",
    url: `/api/v1/auth/oauth/${provider}`,
  });

  const state = cookieValue(begin, OAUTH_STATE_COOKIE);

  const code = issueMockAuthorizationCode(
    provider === "github" ? "github" : "google",
    email,
    harness.config.tokens.secret,
  );

  const callback = await harness.app.inject({
    method: "GET",
    url: `/api/v1/auth/oauth/${provider}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    cookies: { [OAUTH_STATE_COOKIE]: state },
  });

  return { begin, state, callback, refreshToken: cookieValue(callback, "hue_refresh") };
};

describe("GET /auth/oauth/providers", () => {
  it("advertises every provider when running on the stand-in", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/providers",
    });

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)).toEqual({ providers: [...OAUTH_PROVIDERS], mock: true });
  });
});

describe.each(OAUTH_PROVIDERS)("signing in with %s", (provider) => {
  it("redirects to the provider and remembers the state", async () => {
    const begin = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/${provider}`,
    });

    expect(begin.statusCode).toBe(302);
    expect(begin.headers["location"]).toContain(`/oauth/${provider}/consent`);
    expect(cookieValue(begin, OAUTH_STATE_COOKIE)).not.toBe("");
  });

  it("creates an account with no password on first sign-in", async () => {
    const { callback, refreshToken } = await signInWith(
      provider,
      `${provider}-newcomer@example.com`,
    );

    expect(callback.statusCode).toBe(302);
    expect(callback.headers["location"]).toContain("/oauth/complete");
    expect(refreshToken).not.toBe("");

    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { hue_refresh: refreshToken },
    });

    expect(jsonOf(grant)["user"]).toMatchObject({
      email: `${provider}-newcomer@example.com`,
      hasPassword: false,
      role: "customer",
    });
  });

  it("records the identity against the provider", async () => {
    await signInWith(provider, `${provider}-linked@example.com`);

    const rows = await harness.database.sql<
      { provider: string; subject: string }[]
    >`SELECT provider, subject FROM oauth_identity`;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider).toBe(provider);
    expect(rows[0]?.subject).not.toBe(`${provider}-linked@example.com`);
  });

  it("reuses the same account on a second sign-in", async () => {
    await signInWith(provider, `${provider}-repeat@example.com`);
    await signInWith(provider, `${provider}-repeat@example.com`);

    const users = await harness.database
      .sql`SELECT id FROM app_user WHERE email = ${`${provider}-repeat@example.com`}`;
    const identities = await harness.database.sql`SELECT id FROM oauth_identity`;

    expect(users).toHaveLength(1);
    expect(identities).toHaveLength(1);
  });

  it("links to an existing password account rather than duplicating the person", async () => {
    await registerUser(harness, `${provider}-existing@example.com`);
    await signInWith(provider, `${provider}-existing@example.com`);

    const users = await harness.database
      .sql`SELECT id FROM app_user WHERE email = ${`${provider}-existing@example.com`}`;

    expect(users).toHaveLength(1);

    // Linking must not remove the password they already had.
    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {
        email: `${provider}-existing@example.com`,
        password: VALID_PASSWORD,
      },
    });

    expect(jsonOf(grant)["status"]).toBe("authenticated");
  });

  it("reports the provider it was actually signed in with", async () => {
    // The account page reads this. It used to name Google whatever you had
    // signed in with, because the provider was never on the wire at all.
    const { refreshToken } = await signInWith(
      provider,
      `${provider}-named@example.com`,
    );

    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { hue_refresh: refreshToken },
    });

    expect(jsonOf(grant)["user"]).toMatchObject({
      hasPassword: false,
      providers: [provider],
    });
  });

  it("adds the provider to an account that already had a password", async () => {
    await registerUser(harness, `${provider}-fresh@example.com`);
    const { refreshToken } = await signInWith(
      provider,
      `${provider}-fresh@example.com`,
    );

    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { hue_refresh: refreshToken },
    });

    expect(jsonOf(grant)["user"]).toMatchObject({
      hasPassword: true,
      providers: [provider],
    });
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const code = issueMockAuthorizationCode(
      provider === "github" ? "github" : "google",
      "forged@example.com",
      harness.config.tokens.secret,
    );

    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/${provider}/callback?code=${encodeURIComponent(code)}&state=attacker-state`,
      cookies: { [OAUTH_STATE_COOKIE]: "the-real-state" },
    });

    expect(response.statusCode).toBe(400);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "OAuthStateInvalid" });
    expect(await harness.database.sql`SELECT id FROM app_user`).toHaveLength(0);
  });

  it("rejects a callback with no state cookie at all", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/${provider}/callback?code=abc&state=abc`,
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("an account with more than one provider", () => {
  it("lists every provider linked to it", async () => {
    // Two providers reporting the same verified address are one person, so
    // the second sign-in links rather than duplicating — and the account has
    // to be able to say both.
    await signInWith("google", "both@example.com");
    const { refreshToken } = await signInWith("github", "both@example.com");

    const users = await harness.database
      .sql`SELECT id FROM app_user WHERE email = 'both@example.com'`;

    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { hue_refresh: refreshToken },
    });

    expect(users).toHaveLength(1);
    expect(jsonOf(grant)["user"]).toMatchObject({
      providers: ["github", "google"],
    });
  });
});

describe("adding a password to a provider account", () => {
  const setPassword = async (accessToken: string, password: string) =>
    harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { password },
    });

  /** Signs in through a provider and returns a usable access token. */
  const tokenFor = async (email: string): Promise<string> => {
    const { refreshToken } = await signInWith("google", email);
    const grant = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { hue_refresh: refreshToken },
    });
    return String(jsonOf(grant)["accessToken"]);
  };

  it("lets an account with no password set one", async () => {
    const token = await tokenFor("adds-password@example.com");
    const response = await setPassword(token, VALID_PASSWORD);

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)).toMatchObject({
      hasPassword: true,
      providers: ["google"],
    });
  });

  it("makes email sign-in work afterwards", async () => {
    const token = await tokenFor("then-logs-in@example.com");
    await setPassword(token, VALID_PASSWORD);

    const login = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "then-logs-in@example.com", password: VALID_PASSWORD },
    });

    expect(jsonOf(login)["status"]).toBe("authenticated");
  });

  it("keeps the provider working too", async () => {
    const token = await tokenFor("keeps-provider@example.com");
    await setPassword(token, VALID_PASSWORD);

    const { callback } = await signInWith("google", "keeps-provider@example.com");
    const users = await harness.database
      .sql`SELECT id FROM app_user WHERE email = 'keeps-provider@example.com'`;

    expect(callback.statusCode).toBe(302);
    expect(users).toHaveLength(1);
  });

  it("refuses to overwrite a password that already exists", async () => {
    // A stolen session must not be able to change the password: that needs the
    // old one, or a token mailed to the address.
    const token = await tokenFor("has-password@example.com");
    await setPassword(token, VALID_PASSWORD);

    const second = await setPassword(token, `${VALID_PASSWORD}-again`);

    expect(second.statusCode).toBe(409);
    expect(jsonOf(second)["error"]).toMatchObject({ code: "PasswordAlreadySet" });
  });

  it("rejects a weak password", async () => {
    const token = await tokenFor("weak@example.com");
    expect((await setPassword(token, "password")).statusCode).toBe(422);
  });

  it("refuses an unauthenticated caller", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/password",
      payload: { password: VALID_PASSWORD },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("provider isolation", () => {
  it("refuses a code minted for another provider", async () => {
    const begin = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/google",
    });
    const state = cookieValue(begin, OAUTH_STATE_COOKIE);

    // Signed for GitHub, presented at Google's callback.
    const code = issueMockAuthorizationCode(
      "github",
      "crossover@example.com",
      harness.config.tokens.secret,
    );

    const callback = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      cookies: { [OAUTH_STATE_COOKIE]: state },
    });

    // The failure redirects to the sign-in page rather than 500ing.
    expect(callback.statusCode).toBe(302);
    expect(callback.headers["location"]).toContain("error=OAuthExchangeFailed");
    expect(await harness.database.sql`SELECT id FROM app_user`).toHaveLength(0);
  });

  it("treats the same address on two providers as two identities on one account", async () => {
    await signInWith("google", "both@example.com");
    await signInWith("github", "both@example.com");

    const users = await harness.database
      .sql`SELECT id FROM app_user WHERE email = 'both@example.com'`;
    const identities = await harness.database
      .sql<{ provider: string }[]>`SELECT provider FROM oauth_identity ORDER BY provider`;

    // One person, one account, two ways in.
    expect(users).toHaveLength(1);
    expect(identities.map((row) => row.provider)).toEqual(["github", "google"]);
  });
});

describe("unknown providers", () => {
  // A name that is not a provider is rejected either by the schema (422) or,
  // for a path the router normalizes away first, by routing (404). Both mean
  // "not a provider" and neither signs anyone in, which is what matters.
  const REJECTED = [404, 422];

  it("refuses to treat an unknown name as a provider", async () => {
    for (const name of ["facebook", "GOOGLE", "..", "google%20", "goo.gle"]) {
      const response = await harness.app.inject({
        method: "GET",
        url: `/api/v1/auth/oauth/${name}`,
      });

      expect(REJECTED, name).toContain(response.statusCode);
    }
  });

  it("resolves a dot-segment path to the provider it normalizes to", async () => {
    // `google/../github` is `github` after the router normalizes it, and is
    // handled as GitHub. Worth pinning down: the normalization cannot reach a
    // name that is not a provider, and the provider reached is the one the
    // normalized path names.
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/google/../github",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers["location"]).toContain("/oauth/github/consent");
  });

  it("refuses an unknown provider's callback", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/facebook/callback?code=abc&state=abc",
    });

    expect(REJECTED).toContain(response.statusCode);
  });

  it("never mints a session for one", async () => {
    await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/facebook/callback?code=abc&state=abc",
    });

    expect(await harness.database.sql`SELECT id FROM session`).toHaveLength(0);
  });
});

describe("the mock consent screen", () => {
  it("names the provider it is standing in for", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/oauth/github/consent?state=abc&redirect_uri=http://localhost:3000/cb",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.body).toContain("GitHub");
    expect(response.body).toContain("/api/v1/auth/oauth/github/consent");
  });

  it("escapes the values it echoes back into the form", async () => {
    const response = await harness.app.inject({
      method: "GET",
      url: `/api/v1/auth/oauth/google/consent?state=${encodeURIComponent('"><script>alert(1)</script>')}&redirect_uri=http://localhost:3000/cb`,
    });

    expect(response.body).not.toContain("<script>alert(1)</script>");
    expect(response.body).toContain("&lt;script&gt;");
  });

  it("issues a code the matching provider accepts", async () => {
    const consent = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/oauth/github/consent",
      payload: {
        email: "via-form@example.com",
        state: "abc",
        redirect_uri: "http://localhost:3000/api/v1/auth/oauth/github/callback",
      },
    });

    expect(consent.statusCode).toBe(302);
    expect(consent.headers["location"]).toContain("code=");
  });
});
