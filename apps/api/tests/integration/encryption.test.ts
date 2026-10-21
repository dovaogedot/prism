/**
 * Encryption at rest for every sealed column that identifies a person: each
 * one is written as ciphertext that holds none of the plain text, opens to
 * the value the API was given, and is served opened. The order and payment
 * columns are covered beside the checkout, in `orders.test.ts`.
 */

import { Email } from "@prism/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { MockAuthorizationCode, ProviderSubject } from "../../src/platform/oauth.ts";
import { TotpSecret } from "../../src/platform/totp.ts";
import { cookieValue, jsonOf, registerUser, startHarness, type Harness } from "../support/harness.ts";

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

/** Bytes as the driver returns them, as text a search can look through. */
const textOf = (value: unknown): string => Buffer.from(value as Uint8Array).toString("latin1");

/** Opens a sealed column read straight from the table. */
const opened = <S extends z.ZodType>(value: unknown, schema: S): z.output<S> =>
  harness.cipher.open(Buffer.from(value as Uint8Array), schema);

describe("the account", () => {
  it("seals the email and the authenticator secret, and serves them opened", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com");
    const setup = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/2fa/setup",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const secret = new URL(String(jsonOf(setup)["uri"])).searchParams.get("secret") ?? "";

    const [row] = await harness.database.sql`SELECT email, email_index, totp_secret FROM app_user`;

    expect(textOf(row?.["email"])).not.toContain("mari");
    expect(opened(row?.["email"], Email.schema)).toBe("mari@example.com");
    expect(textOf(row?.["email_index"])).not.toContain("mari");
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(textOf(row?.["totp_secret"])).not.toContain(secret);
    expect(opened(row?.["totp_secret"], TotpSecret.schema)).toBe(secret);

    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(jsonOf(me)["email"]).toBe("mari@example.com");
  });
});

describe("the provider identity", () => {
  it("seals the subject, and finds the account by it on the next sign-in", async () => {
    const signIn = async () => {
      const begin = await harness.app.inject({ method: "GET", url: "/api/v1/auth/oauth/github" });
      const state = cookieValue(begin, "prism_oauth_state");
      const code = MockAuthorizationCode.issue("github", Email.schema.parse("linked@example.com"), harness.config.tokens.secret);

      return harness.app.inject({
        method: "GET",
        url: `/api/v1/auth/oauth/github/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
        cookies: { prism_oauth_state: state },
      });
    };

    await signIn();
    await signIn();

    const rows = await harness.database.sql`SELECT subject, subject_index FROM oauth_identity`;
    const subject = opened(rows[0]?.["subject"], ProviderSubject.schema);

    expect(rows).toHaveLength(1);
    expect(subject).toMatch(/^mock-/);
    expect(textOf(rows[0]?.["subject"])).not.toContain(subject);
    expect(textOf(rows[0]?.["subject_index"])).not.toContain(subject);
    expect(await harness.database.sql`SELECT id FROM app_user`).toHaveLength(1);
  });
});

describe("the session", () => {
  it("seals the browser and the address it signed in from", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "user-agent": "PrismBrowser/7.1 (Sealed Test)" },
      remoteAddress: "198.51.100.23",
      payload: { email: "agent@example.com", password: "correct horse battery staple", captchaToken: "test-token" },
    });

    const [row] = await harness.database.sql`SELECT user_agent, ip_address FROM session`;

    expect(textOf(row?.["user_agent"])).not.toContain("PrismBrowser");
    expect(textOf(row?.["ip_address"])).not.toContain("198.51.100.23");
    expect(opened(row?.["user_agent"], z.string())).toBe("PrismBrowser/7.1 (Sealed Test)");
    expect(opened(row?.["ip_address"], z.string())).toBe("198.51.100.23");
  });

  it("stores no browser at all when the request named none", async () => {
    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      headers: { "user-agent": "" },
      payload: { email: "silent@example.com", password: "correct horse battery staple", captchaToken: "test-token" },
    });

    expect(await harness.database.sql`SELECT user_agent FROM session`).toEqual([{ user_agent: null }]);
  });
});
