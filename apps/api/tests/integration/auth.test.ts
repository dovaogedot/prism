/**
 * API integration tests for authentication.
 *
 * These run against a real Postgres, so they cover both the endpoint contract
 * and the database operations behind it — the persistence assertions read rows
 * back rather than trusting the response.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

/**
 * A fixed object shape rather than a conditional spread: spreading makes the
 * argument a union, which stops matching Fastify's `InjectOptions` and sends
 * inference to the wrong overload.
 */
const post = (url: string, payload: object, token?: string) => {
  const headers: Record<string, string> =
    token === undefined ? {} : { authorization: `Bearer ${token}` };

  return harness.app.inject({ method: "POST", url, payload, headers });
};

describe("POST /auth/register", () => {
  it("creates an account and returns a grant", async () => {
    const { response, accessToken } = await registerUser(harness, "a@example.com");

    expect(response.statusCode).toBe(201);
    expect(accessToken.split(".")).toHaveLength(3);
    expect(jsonOf(response)["user"]).toMatchObject({
      email: "a@example.com",
      twoFactorEnabled: false,
      hasPassword: true,
    });
  });

  it("persists the user with a hashed password", async () => {
    await registerUser(harness, "a@example.com");

    const rows = await harness.database.sql<
      { email: string; password_hash: string }[]
    >`SELECT email, password_hash FROM app_user`;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.email).toBe("a@example.com");
    expect(rows[0]?.password_hash).not.toBe(VALID_PASSWORD);
  });

  it("opens a session and issues one refresh token for it", async () => {
    await registerUser(harness, "a@example.com");

    const sessions = await harness.database.sql`SELECT id, revoked_at FROM session`;
    const tokens = await harness.database.sql`SELECT used_at FROM refresh_token`;

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.["revoked_at"]).toBeNull();
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.["used_at"]).toBeNull();
  });

  it("sets the refresh token in a scoped httpOnly cookie", async () => {
    const { response } = await registerUser(harness, "a@example.com");
    const cookie = response.cookies.find((entry) => entry.name === "prism_refresh");

    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      path: "/api/v1/auth",
    });
  });

  it("stores the refresh token only as a digest", async () => {
    const { refreshToken } = await registerUser(harness, "a@example.com");

    const rows = await harness.database.sql<
      { token_hash: string }[]
    >`SELECT token_hash FROM refresh_token`;

    expect(rows[0]?.token_hash).not.toBe(refreshToken);
    expect(rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes the email so one person cannot hold two accounts", async () => {
    await registerUser(harness, "Someone@Example.COM");
    const duplicate = await registerUser(harness, "someone@example.com");

    expect(duplicate.response.statusCode).toBe(409);
    expect(jsonOf(duplicate.response)["error"]).toMatchObject({
      code: "EmailAlreadyRegistered",
    });
  });

  it("rejects a weak password before touching the database", async () => {
    const response = await post("/api/v1/auth/register", {
      email: "a@example.com",
      password: "short",
      captchaToken: "t",
    });

    expect(response.statusCode).toBe(422);
    expect(await harness.database.sql`SELECT 1 FROM app_user`).toHaveLength(0);
  });

  it("requires a CAPTCHA response", async () => {
    const response = await post("/api/v1/auth/register", {
      email: "a@example.com",
      password: VALID_PASSWORD,
      captchaToken: "",
    });

    expect(response.statusCode).toBe(422);
  });
});

describe("POST /auth/login", () => {
  beforeEach(async () => {
    await registerUser(harness, "a@example.com");
  });

  it("returns an authenticated outcome for the right password", async () => {
    const response = await post("/api/v1/auth/login", {
      email: "a@example.com",
      password: VALID_PASSWORD,
    });

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)["status"]).toBe("authenticated");
  });

  it("refuses the wrong password", async () => {
    const response = await post("/api/v1/auth/login", {
      email: "a@example.com",
      password: "not the right one at all",
    });

    expect(response.statusCode).toBe(401);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "InvalidCredentials" });
  });

  it("answers an unknown address exactly as it answers a wrong password", async () => {
    const unknown = await post("/api/v1/auth/login", {
      email: "nobody@example.com",
      password: "not the right one at all",
    });
    const wrong = await post("/api/v1/auth/login", {
      email: "a@example.com",
      password: "not the right one at all",
    });

    expect(unknown.statusCode).toBe(wrong.statusCode);
    expect(jsonOf(unknown)).toEqual(jsonOf(wrong));
  });

  it("opens a second session without disturbing the first", async () => {
    await post("/api/v1/auth/login", {
      email: "a@example.com",
      password: VALID_PASSWORD,
    });

    const sessions = await harness.database.sql`SELECT revoked_at FROM session`;

    expect(sessions).toHaveLength(2);
    expect(sessions.every((row) => row["revoked_at"] === null)).toBe(true);
  });
});

describe("POST /auth/refresh — rotation and reuse", () => {
  it("issues a new refresh token and marks the old one used", async () => {
    const { refreshToken } = await registerUser(harness, "a@example.com");

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });

    expect(response.statusCode).toBe(200);

    const rotated = cookieValue(response, "prism_refresh");
    expect(rotated).not.toBe(refreshToken);
    expect(rotated).not.toBe("");

    const rows = await harness.database
      .sql`SELECT used_at FROM refresh_token ORDER BY created_at`;
    expect(rows).toHaveLength(2);
    expect(rows[0]?.["used_at"]).not.toBeNull();
    expect(rows[1]?.["used_at"]).toBeNull();
  });

  it("rejects a token that has already been spent", async () => {
    const { refreshToken } = await registerUser(harness, "a@example.com");

    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });

    const replay = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });

    expect(replay.statusCode).toBe(401);
    expect(jsonOf(replay)["error"]).toMatchObject({ code: "RefreshTokenReused" });
  });

  it("revokes the whole session when a token is replayed", async () => {
    const { refreshToken } = await registerUser(harness, "a@example.com");

    const rotation = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });
    const goodToken = cookieValue(rotation, "prism_refresh");

    // The attacker replays the stolen, already-used token…
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });

    // …which must also lock out the legitimate holder of the current token.
    const legitimate = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: goodToken },
    });

    expect(legitimate.statusCode).toBe(401);

    const sessions = await harness.database
      .sql`SELECT revoked_at, revoked_reason FROM session`;
    expect(sessions[0]?.["revoked_at"]).not.toBeNull();
    expect(sessions[0]?.["revoked_reason"]).toBe("token_reuse");
  });

  it("rejects a token that was never issued", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: "not-a-real-token" },
    });

    expect(response.statusCode).toBe(401);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "RefreshTokenInvalid" });
  });

  it("rejects a refresh with no cookie at all", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
    });

    expect(response.statusCode).toBe(401);
  });

  it("refuses a refresh token past its lifetime", async () => {
    const { refreshToken } = await registerUser(harness, "a@example.com");

    harness.clock.advanceSeconds(harness.config.tokens.refreshTtlSeconds + 1);

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/refresh",
      cookies: { prism_refresh: refreshToken },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("token revocation", () => {
  it("kills the access token the instant the session is revoked", async () => {
    const { accessToken } = await registerUser(harness, "a@example.com");

    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).statusCode,
    ).toBe(200);

    await post("/api/v1/auth/logout", {}, accessToken);

    // The JWT is still perfectly valid and unexpired. The session is not.
    const after = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(after.statusCode).toBe(401);
    expect(jsonOf(after)["error"]).toMatchObject({ code: "SessionRevoked" });
  });

  it("expires the access token on schedule", async () => {
    const { accessToken } = await registerUser(harness, "a@example.com");

    harness.clock.advanceSeconds(harness.config.tokens.accessTtlSeconds + 1);

    const response = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("password recovery", () => {
  it("emails a reset link when the address exists", async () => {
    await registerUser(harness, "a@example.com");

    const response = await post("/api/v1/auth/password/forgot", {
      email: "a@example.com",
    });

    expect(response.statusCode).toBe(204);
    expect(harness.mailer.sent).toHaveLength(1);
    expect(harness.mailer.sent[0]?.to).toBe("a@example.com");
    expect(harness.mailer.sent[0]?.text).toContain("/reset-password?token=");
  });

  it("answers identically for an address that does not exist", async () => {
    const response = await post("/api/v1/auth/password/forgot", {
      email: "nobody@example.com",
    });

    expect(response.statusCode).toBe(204);
    expect(harness.mailer.sent).toHaveLength(0);
  });

  it("stores the reset token only as a digest", async () => {
    await registerUser(harness, "a@example.com");
    await post("/api/v1/auth/password/forgot", { email: "a@example.com" });

    const rows = await harness.database
      .sql<{ token_hash: string }[]>`SELECT token_hash FROM password_reset_token`;

    const emailed = /token=([^\s]+)/.exec(harness.mailer.sent[0]?.text ?? "")?.[1] ?? "";

    expect(rows[0]?.token_hash).not.toBe(decodeURIComponent(emailed));
    expect(rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  const resetTokenFrom = (harnessRef: Harness): string =>
    decodeURIComponent(
      /token=([^\s]+)/.exec(harnessRef.mailer.sent[0]?.text ?? "")?.[1] ?? "",
    );

  it("changes the password and ends every session", async () => {
    const { accessToken } = await registerUser(harness, "a@example.com");
    await post("/api/v1/auth/password/forgot", { email: "a@example.com" });

    const response = await post("/api/v1/auth/password/reset", {
      token: resetTokenFrom(harness),
      password: "an entirely different passphrase",
    });

    expect(response.statusCode).toBe(204);

    // Whoever knew the old password no longer has a way in.
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { authorization: `Bearer ${accessToken}` },
        })
      ).statusCode,
    ).toBe(401);

    expect(
      jsonOf(
        await post("/api/v1/auth/login", {
          email: "a@example.com",
          password: "an entirely different passphrase",
        }),
      )["status"],
    ).toBe("authenticated");
  });

  it("accepts a reset token exactly once", async () => {
    await registerUser(harness, "a@example.com");
    await post("/api/v1/auth/password/forgot", { email: "a@example.com" });
    const token = resetTokenFrom(harness);

    await post("/api/v1/auth/password/reset", {
      token,
      password: "an entirely different passphrase",
    });

    const second = await post("/api/v1/auth/password/reset", {
      token,
      password: "yet another passphrase here",
    });

    expect(second.statusCode).toBe(400);
    expect(jsonOf(second)["error"]).toMatchObject({ code: "ResetTokenInvalid" });
  });

  it("refuses an expired reset token", async () => {
    await registerUser(harness, "a@example.com");
    await post("/api/v1/auth/password/forgot", { email: "a@example.com" });
    const token = resetTokenFrom(harness);

    harness.clock.advanceSeconds(harness.config.tokens.passwordResetTtlSeconds + 1);

    const response = await post("/api/v1/auth/password/reset", {
      token,
      password: "an entirely different passphrase",
    });

    expect(response.statusCode).toBe(400);
  });
});

describe("GET /auth/me", () => {
  it("refuses an anonymous request", async () => {
    expect(
      (await harness.app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode,
    ).toBe(401);
  });

  it("refuses a malformed authorization header", async () => {
    for (const header of ["", "Bearer", "Basic abc", "Bearer ", "token abc"]) {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: { authorization: header },
      });

      expect(response.statusCode, header).toBe(401);
    }
  });
});
