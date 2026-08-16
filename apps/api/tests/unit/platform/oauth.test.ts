/**
 * OAuth provider behavior that is pure enough to test without a network:
 * the registry, the offline mock's code signing, and GitHub's email selection.
 */

import { Option } from "@prism/shared";
import { describe, expect, it } from "vitest";
import {
  createGitHubOAuthProvider,
  createGoogleOAuthProvider,
  createMockOAuthProvider,
  createOAuthRegistry,
  issueMockAuthorizationCode,
  selectGitHubEmail,
} from "../../../src/platform/oauth.ts";

const SECRET = new TextEncoder().encode("a".repeat(48));

describe("the registry", () => {
  const registry = createOAuthRegistry(
    [
      createMockOAuthProvider("google", SECRET),
      createMockOAuthProvider("github", SECRET),
    ],
    true,
  );

  it("lists what it holds", () => {
    expect(registry.names).toEqual(["google", "github"]);
  });

  it("finds a provider by name", () => {
    const found = registry.find("github");
    expect(Option.isSome(found)).toBe(true);
  });

  it("returns None for anything it does not hold", () => {
    for (const name of ["facebook", "GITHUB", "", "../google", "google "]) {
      expect(registry.find(name), name).toEqual(Option.none);
    }
  });

  it("offers only the providers it was built with", () => {
    const githubOnly = createOAuthRegistry(
      [createGitHubOAuthProvider("id", "secret")],
      false,
    );

    expect(githubOnly.names).toEqual(["github"]);
    expect(githubOnly.find("google")).toEqual(Option.none);
    expect(githubOnly.isMock).toBe(false);
  });
});

describe("authorization URLs", () => {
  it("sends GitHub the scopes needed to read a private email", () => {
    const url = createGitHubOAuthProvider("client-123", "secret").authorizationUrl(
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
    const url = createGitHubOAuthProvider("client-123", "super-secret").authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(url).not.toContain("super-secret");
  });

  it("asks Google for the openid email scope", () => {
    const url = createGoogleOAuthProvider("client-123", "secret").authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(new URL(url).searchParams.get("scope")).toContain("email");
  });

  it("points the mock at a consent screen served by this API", () => {
    const url = createMockOAuthProvider("github", SECRET).authorizationUrl(
      "state",
      "http://localhost:3000/cb",
    );

    expect(url.startsWith("/api/v1/auth/oauth/github/consent?")).toBe(true);
  });
});

describe("the mock provider", () => {
  const google = createMockOAuthProvider("google", SECRET);
  const github = createMockOAuthProvider("github", SECRET);

  it("accepts a code it issued", async () => {
    const code = issueMockAuthorizationCode("github", "someone@example.com", SECRET);
    const result = await github.exchange(code, "http://localhost:3000/cb");

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toMatchObject({
      provider: "github",
      email: "someone@example.com",
    });
  });

  it("rejects a code it did not issue", async () => {
    const forged = issueMockAuthorizationCode(
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
    const githubCode = issueMockAuthorizationCode("github", "a@example.com", SECRET);

    expect((await google.exchange(githubCode, "cb")).isErr()).toBe(true);
  });

  it("rejects malformed codes without throwing", async () => {
    for (const code of ["", "no-dot", "a.b.c", ".", "..", "x."]) {
      expect((await github.exchange(code, "cb")).isErr(), code).toBe(true);
    }
  });

  it("gives the same address a stable subject", async () => {
    const code = issueMockAuthorizationCode("github", "a@example.com", SECRET);

    const first = await github.exchange(code, "cb");
    const second = await github.exchange(code, "cb");

    expect(first._unsafeUnwrap().subject).toBe(second._unsafeUnwrap().subject);
  });

  it("treats the same address on two providers as two identities", async () => {
    const forGoogle = issueMockAuthorizationCode("google", "a@example.com", SECRET);
    const forGithub = issueMockAuthorizationCode("github", "a@example.com", SECRET);

    const googleProfile = await google.exchange(forGoogle, "cb");
    const githubProfile = await github.exchange(forGithub, "cb");

    expect(googleProfile._unsafeUnwrap().subject).not.toBe(
      githubProfile._unsafeUnwrap().subject,
    );
  });
});

describe("selectGitHubEmail", () => {
  const entry = (
    email: string,
    primary: boolean,
    verified: boolean,
  ): Record<string, unknown> => ({ email, primary, verified });

  it("prefers the primary verified address", () => {
    expect(
      selectGitHubEmail([
        entry("secondary@example.com", false, true),
        entry("primary@example.com", true, true),
      ]),
    ).toEqual(Option.some("primary@example.com"));
  });

  it("falls back to any verified address when none is primary", () => {
    expect(
      selectGitHubEmail([entry("only@example.com", false, true)]),
    ).toEqual(Option.some("only@example.com"));
  });

  it("refuses an unverified address even when it is primary", () => {
    // Accepting one would let anybody who types a victim's address into
    // GitHub link themselves to that account here.
    expect(
      selectGitHubEmail([entry("unverified@example.com", true, false)]),
    ).toEqual(Option.none);
  });

  it("skips an unverified primary in favor of a verified one", () => {
    expect(
      selectGitHubEmail([
        entry("unverified@example.com", true, false),
        entry("verified@example.com", false, true),
      ]),
    ).toEqual(Option.some("verified@example.com"));
  });

  it("lowercases the address so one person is one account", () => {
    expect(selectGitHubEmail([entry("Someone@Example.COM", true, true)])).toEqual(
      Option.some("someone@example.com"),
    );
  });

  it("returns None for an empty list", () => {
    expect(selectGitHubEmail([])).toEqual(Option.none);
  });

  it("returns None for anything that is not a list of addresses", () => {
    for (const payload of [null, undefined, {}, "nope", 42, [{ nope: true }]]) {
      expect(selectGitHubEmail(payload)).toEqual(Option.none);
    }
  });

  it("ignores malformed entries mixed in with good ones", () => {
    expect(
      selectGitHubEmail([
        { garbage: true },
        entry("good@example.com", true, true),
      ]),
    ).toEqual(Option.some("good@example.com"));
  });
});
