/**
 * JWT generation, validation and expiration.
 *
 * The injected clock is what makes the expiry cases instant: proving a
 * 15-minute token expires takes no wall-clock time at all.
 */

import { describe, expect, it } from "vitest";
import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { UserId } from "@prism/shared";
import { SessionId } from "../../../src/db/ids.ts";
import { Clock } from "../../../src/platform/clock.ts";
import { OpaqueToken, RefreshToken, TokenId, TokenService } from "../../../src/platform/tokens.ts";

const SECRET = new TextEncoder().encode("a".repeat(64));
const OTHER_SECRET = new TextEncoder().encode("b".repeat(64));
const START = new Date("2026-08-07T12:00:00.000Z");

const ACCESS_TTL = 900;

const build = (): Readonly<{
  tokens: TokenService;
  clock: ReturnType<typeof Clock.mutable>;
}> => {
  const clock = Clock.mutable(START);

  return {
    clock,
    tokens: TokenService.create({
      secret: SECRET,
      issuer: "prism",
      accessTtlSeconds: ACCESS_TTL,
      twoFactorChallengeTtlSeconds: 300,
      clock,
    }),
  };
};

const claims = {
  subject: UserId.schema.parse("11111111-1111-4111-8111-111111111111"),
  sessionId: SessionId.schema.parse("22222222-2222-4222-8222-222222222222"),
  tokenId: TokenId.schema.parse("33333333-3333-4333-8333-333333333333"),
} as const;

describe("access token generation", () => {
  it("produces a three-part JWT", async () => {
    const { tokens } = build();
    const issued = await tokens.issueAccessToken(claims);

    expect(issued.isOk()).toBe(true);
    expect(issued._unsafeUnwrap().split(".")).toHaveLength(3);
  });

  it("signs with HS256 and says so in the header", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "HS256", typ: "JWT" });
  });

  it("carries the session id, so the token can be revoked", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    expect(decodeJwt(token)).toMatchObject({
      sub: claims.subject,
      sid: claims.sessionId,
      jti: claims.tokenId,
    });
  });

  it("dates the token from the injected clock, not the wall clock", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();
    const payload = decodeJwt(token);

    expect(payload.iat).toBe(Math.floor(START.getTime() / 1000));
    expect(payload.exp).toBe(Math.floor(START.getTime() / 1000) + ACCESS_TTL);
  });

  it("puts no password, email or secret in the payload", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    // A JWT is signed, not encrypted — anyone holding it can read the payload.
    expect(Object.keys(decodeJwt(token)).sort()).toEqual(
      ["aud", "exp", "iat", "iss", "jti", "nbf", "sid", "sub"].sort(),
    );
  });
});

describe("access token validation", () => {
  it("accepts a token it just issued", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    const verified = await tokens.verifyAccessToken(token);

    expect(verified.isOk()).toBe(true);
    expect(verified._unsafeUnwrap()).toEqual(claims);
  });

  it("rejects a token signed with a different secret", async () => {
    const { tokens } = build();

    const forged = await new SignJWT({ sub: "x", sid: "y", jti: "z" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("prism")
      .setAudience("access")
      .setExpirationTime("1h")
      .sign(OTHER_SECRET);

    const verified = await tokens.verifyAccessToken(forged);

    expect(verified.isErr()).toBe(true);
    expect(verified._unsafeUnwrapErr()).toEqual({ _tag: "AccessTokenInvalid" });
  });

  it("rejects an unsigned `alg: none` token", async () => {
    const { tokens } = build();

    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: "x", sid: "y", jti: "z" }),
    ).toString("base64url");

    const verified = await tokens.verifyAccessToken(`${header}.${payload}.`);

    expect(verified.isErr()).toBe(true);
  });

  it("rejects a token whose payload was edited after signing", async () => {
    const { tokens } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    const [header, , signature] = token.split(".");
    const escalated = Buffer.from(
      JSON.stringify({ ...decodeJwt(token), sub: "somebody-else" }),
    ).toString("base64url");

    const verified = await tokens.verifyAccessToken(
      `${header}.${escalated}.${signature}`,
    );

    expect(verified.isErr()).toBe(true);
  });

  it("rejects malformed input rather than throwing", async () => {
    const { tokens } = build();

    for (const candidate of ["", "not-a-token", "a.b", "a.b.c.d", "...."]) {
      const verified = await tokens.verifyAccessToken(candidate);
      expect(verified.isErr(), candidate).toBe(true);
    }
  });
});

describe("access token expiration", () => {
  it("is still valid one second before it expires", async () => {
    const { tokens, clock } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    clock.advanceSeconds(ACCESS_TTL - 1);

    expect((await tokens.verifyAccessToken(token)).isOk()).toBe(true);
  });

  it("is refused once its lifetime has elapsed", async () => {
    const { tokens, clock } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    // jose allows no clock tolerance by default; a second past is past.
    clock.advanceSeconds(ACCESS_TTL + 1);

    const verified = await tokens.verifyAccessToken(token);

    expect(verified.isErr()).toBe(true);
    expect(verified._unsafeUnwrapErr()).toEqual({ _tag: "AccessTokenInvalid" });
  });

  it("is refused before it becomes valid", async () => {
    const { tokens, clock } = build();
    const token = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    clock.advanceSeconds(-60);

    expect((await tokens.verifyAccessToken(token)).isErr()).toBe(true);
  });
});

describe("audience separation", () => {
  it("will not accept a 2FA challenge where an access token belongs", async () => {
    const { tokens } = build();
    const challenge = (
      await tokens.issueTwoFactorChallenge({ subject: claims.subject })
    )._unsafeUnwrap();

    // Both are signed with the same key; only the audience separates them.
    expect((await tokens.verifyAccessToken(challenge)).isErr()).toBe(true);
  });

  it("will not accept an access token as a 2FA challenge", async () => {
    const { tokens } = build();
    const access = (await tokens.issueAccessToken(claims))._unsafeUnwrap();

    expect((await tokens.verifyTwoFactorChallenge(access)).isErr()).toBe(true);
  });

  it("round-trips a challenge for the right subject", async () => {
    const { tokens } = build();
    const challenge = (
      await tokens.issueTwoFactorChallenge({ subject: claims.subject })
    )._unsafeUnwrap();

    const verified = await tokens.verifyTwoFactorChallenge(challenge);

    expect(verified._unsafeUnwrap()).toEqual({ subject: claims.subject });
  });

  it("expires the challenge on its own shorter clock", async () => {
    const { tokens, clock } = build();
    const challenge = (
      await tokens.issueTwoFactorChallenge({ subject: claims.subject })
    )._unsafeUnwrap();

    clock.advanceSeconds(301);

    expect((await tokens.verifyTwoFactorChallenge(challenge)).isErr()).toBe(true);
  });
});

describe("opaque tokens", () => {
  it("returns a plaintext and its digest, which differ", () => {
    const token = OpaqueToken.create(RefreshToken.schema);

    expect(token.plaintext).not.toBe(token.digest);
    expect(token.digest).toBe(OpaqueToken.digest(token.plaintext));
  });

  it("is URL-safe, so it survives an email client", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      expect(OpaqueToken.create(RefreshToken.schema).plaintext).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("carries at least 256 bits of entropy", () => {
    // 32 bytes in base64url is 43 characters.
    expect(OpaqueToken.create(RefreshToken.schema).plaintext.length).toBeGreaterThanOrEqual(43);
  });

  it("never repeats", () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => OpaqueToken.create(RefreshToken.schema).plaintext),
    );

    expect(seen.size).toBe(500);
  });

  it("digests deterministically as 64 hex characters", () => {
    expect(OpaqueToken.digest("hello")).toBe(OpaqueToken.digest("hello"));
    expect(OpaqueToken.digest("hello")).toMatch(/^[a-f0-9]{64}$/);
    expect(OpaqueToken.digest("hello")).not.toBe(OpaqueToken.digest("hellp"));
  });
});
