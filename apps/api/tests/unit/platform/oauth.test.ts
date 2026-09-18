/**
 * OAuth provider behavior that is pure enough to test without a network:
 * the registry, the offline mock's code signing, GitHub's email selection,
 * and the reading of Google's profile.
 */

import { describe, expect, it } from "vitest";
import {
  GitHubEmails,
  GoogleUserInfo,
  IdentityProvider,
  IdentityProviders,
  MockAuthorizationCode,
} from "../../../src/platform/oauth.ts";

const SECRET = new TextEncoder().encode("a".repeat(48));

describe("the registry", () => {
  const registry = IdentityProviders.of(
    [
      IdentityProvider.mock("google", SECRET),
      IdentityProvider.mock("github", SECRET),
    ],
    true,
  );

  it("lists what it holds", () => {
    expect(registry.names).toEqual(["google", "github"]);
  });

  it("finds a provider by name", () => {
    expect(registry.find("github")?.name).toBe("github");
  });

  it("returns undefined for anything it does not hold", () => {
    for (const name of ["facebook", "GITHUB", "", "../google", "google "]) {
      expect(registry.find(name), name).toBeUndefined();
    }
  });

  it("offers only the providers it was built with", () => {
    const githubOnly = IdentityProviders.of(
      [IdentityProvider.github("id", "secret")],
      false,
    );

    expect(githubOnly.names).toEqual(["github"]);
    expect(githubOnly.find("google")).toBeUndefined();
    expect(githubOnly.isMock).toBe(false);
  });
});

describe("authorization URLs", () => {
  it("sends GitHub the scopes needed to read a private email", () => {
    const url = IdentityProvider.github("client-123", "secret").authorizationUrl(
      "state-abc",
      "http://localhost:3000/cb",
    );

    const params = new URL(url).searchParams;

    expect(url.startsWith("https://github.com/login/oauth/authorize")).toBe(true);
    expect(params.get("client_id")).toBe("client-123");
    expect(params.get("state")).toBe("state-abc");
    expect(params.get("redirect_uri")).toBe("http://localhost:3000/cb");
    // Without user:email the emails endpoint 403s and private addresses
    // cannot sign in at all.
    expect(params.get("scope")).toContain("user:email");
  });

  it("never puts the client secret in the URL", () => {
    const url = IdentityProvider.github("client-123", "super-secret").authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(url).not.toContain("super-secret");
  });

  it("asks Google for the openid email scope", () => {
    const url = IdentityProvider.google("client-123", "secret").authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(new URL(url).searchParams.get("scope")).toContain("email");
  });

  it("points the mock at a consent screen served by this API", () => {
    const url = IdentityProvider.mock("github", SECRET).authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(url.startsWith("/api/v1/auth/oauth/github/consent?")).toBe(true);
  });
});

describe("the mock provider", () => {
  const google = IdentityProvider.mock("google", SECRET);
  const github = IdentityProvider.mock("github", SECRET);

  it("accepts a code it issued", async () => {
    const code = MockAuthorizationCode.issue("github", "someone@example.com", SECRET);
    const result = await github.exchange(code, "http://localhost:3000/cb");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      provider: "github",
      email: "someone@example.com",
    });
  });

  it("rejects a code it did not issue", async () => {
    const forged = MockAuthorizationCode.issue(
      "github",
      "someone@example.com",
      new TextEncoder().encode("b".repeat(48)),
    );

    expect((await github.exchange(forged, "cb")).isErr()).toBe(true);
  });

  it("rejects a code issued for a different provider", async () => {
    // The provider is part of what gets signed, so a GitHub code presented at
    // the Google callback fails — the isolation two real providers get from
    // not sharing a client secret.
    const githubCode = MockAuthorizationCode.issue("github", "a@example.com", SECRET);

    expect((await google.exchange(githubCode, "cb")).isErr()).toBe(true);
  });

  it("rejects malformed codes without throwing", async () => {
    for (const code of ["", "no-dot", "a.b.c", ".", "..", "x."]) {
      expect((await github.exchange(code, "cb")).isErr(), code).toBe(true);
    }
  });

  it("gives the same address a stable subject", async () => {
    const code = MockAuthorizationCode.issue("github", "a@example.com", SECRET);

    const first = await github.exchange(code, "cb");
    const second = await github.exchange(code, "cb");

    expect(first._unsafeUnwrap().subject).toBe(second._unsafeUnwrap().subject);
  });

  it("treats the same address on two providers as two identities", async () => {
    const forGoogle = MockAuthorizationCode.issue("google", "a@example.com", SECRET);
    const forGithub = MockAuthorizationCode.issue("github", "a@example.com", SECRET);

    const googleProfile = await google.exchange(forGoogle, "cb");
    const githubProfile = await github.exchange(forGithub, "cb");

    expect(googleProfile._unsafeUnwrap().subject).not.toBe(
      githubProfile._unsafeUnwrap().subject,
    );
  });
});

describe("GitHubEmails.select", () => {
  const entry = (
    email: string,
    primary: boolean,
    verified: boolean,
  ): Record<string, unknown> => ({ email, primary, verified });

  it("prefers the primary verified address", () => {
    expect(
      GitHubEmails.select([
        entry("secondary@example.com", false, true),
        entry("primary@example.com", true, true),
      ]),
    ).toBe("primary@example.com");
  });

  it("falls back to any verified address when none is primary", () => {
    expect(
      GitHubEmails.select([entry("only@example.com", false, true)]),
    ).toBe("only@example.com");
  });

  it("refuses an unverified address even when it is primary", () => {
    // Accepting one would let anybody who types a victim's address into
    // GitHub link themselves to that account here.
    expect(
      GitHubEmails.select([entry("unverified@example.com", true, false)]),
    ).toBeUndefined();
  });

  it("skips an unverified primary in favor of a verified one", () => {
    expect(
      GitHubEmails.select([
        entry("unverified@example.com", true, false),
        entry("verified@example.com", false, true),
      ]),
    ).toBe("verified@example.com");
  });

  it("lowercases the address so one person is one account", () => {
    expect(GitHubEmails.select([entry("Someone@Example.COM", true, true)])).toBe("someone@example.com");
  });

  it("returns undefined for an empty list", () => {
    expect(GitHubEmails.select([])).toBeUndefined();
  });

  it("returns undefined for anything that is not a list of addresses", () => {
    for (const payload of [null, undefined, {}, "nope", 42, [{ nope: true }]]) {
      expect(GitHubEmails.select(payload)).toBeUndefined();
    }
  });

  it("ignores malformed entries mixed in with good ones", () => {
    expect(
      GitHubEmails.select([
        { garbage: true },
        entry("good@example.com", true, true),
      ]),
    ).toBe("good@example.com");
  });
});

describe("GoogleUserInfo.read", () => {
  const info = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
    sub: "1234567890",
    email: "someone@example.com",
    email_verified: true,
    ...fields,
  });

  it("reads the stable id and the verified address", () => {
    expect(GoogleUserInfo.read(info({}))._unsafeUnwrap()).toEqual({
      provider: "google",
      subject: "1234567890",
      email: "someone@example.com",
    });
  });

  it("refuses an address Google has not verified", () => {
    // Accepting one would link whoever registered a victim's address at
    // Google to the victim's account here.
    expect(GoogleUserInfo.read(info({ email_verified: false }))._unsafeUnwrapErr()).toEqual({
      _tag: "OAuthEmailUnavailable",
    });
  });

  it("refuses an answer that leaves the verification out", () => {
    const { email_verified: _verified, ...silent } = info({});

    expect(GoogleUserInfo.read(silent)._unsafeUnwrapErr()).toEqual({ _tag: "OAuthEmailUnavailable" });
  });

  it("takes only a boolean true as verified", () => {
    for (const verified of ["true", 1, null]) {
      expect(GoogleUserInfo.read(info({ email_verified: verified }))._unsafeUnwrapErr(), String(verified)).toEqual({
        _tag: "OAuthEmailUnavailable",
      });
    }
  });

  it("refuses an answer without an address", () => {
    const { email: _email, ...anonymous } = info({});

    expect(GoogleUserInfo.read(anonymous)._unsafeUnwrapErr()).toEqual({ _tag: "OAuthEmailUnavailable" });
  });

  it("lowercases the address so one person is one account", () => {
    expect(GoogleUserInfo.read(info({ email: "Someone@Example.COM" }))._unsafeUnwrap().email).toBe(
      "someone@example.com",
    );
  });

  it("fails the exchange for anything that is not a profile", () => {
    for (const payload of [null, undefined, {}, "nope", 42, info({ sub: 42 })]) {
      expect(GoogleUserInfo.read(payload)._unsafeUnwrapErr(), JSON.stringify(payload)).toEqual({
        _tag: "OAuthExchangeFailed",
      });
    }
  });
});
