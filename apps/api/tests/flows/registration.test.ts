/**
 * Registration as a shopper lives it: a guest fills a cart, opens an
 * account, finds the cart waiting, signs out and back in. Passwords are
 * hashed with the real Argon2, so what is stored is what production stores.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Email } from "@prism/shared";
import { Hasher } from "../../src/platform/hasher.ts";
import { Shop } from "../support/commerce.ts";
import { cookieValue, jsonOf, seedCatalog, startHarness, VALID_PASSWORD, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness({ hasher: Hasher.argon2() });
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, stock: 2 },
  ]);
});

afterAll(async () => {
  await harness.stop();
});

describe("a guest who registers", () => {
  it("keeps the cart, is stored safely, and can sign out and back in", async () => {
    const guest = await Shop.fill(harness, [
      ["desk-lamp", 2],
      ["oak-chair", 1],
    ]);

    // Opening the account, with the CAPTCHA token the widget would hand over.
    const registered = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "  New.Shopper@Example.COM ", password: VALID_PASSWORD, captchaToken: "widget-token" },
    });
    expect(registered.statusCode).toBe(201);
    const grant = jsonOf(registered) as { accessToken: string; user: { email: string } };
    expect(grant.user.email).toBe("new.shopper@example.com");
    expect(cookieValue(registered, "prism_refresh")).not.toBe("");

    // Who the session says it is.
    const me = await harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    expect(jsonOf(me)).toMatchObject({ email: "new.shopper@example.com", hasPassword: true, twoFactorEnabled: false });

    // What was stored: the lowercase address sealed, and an Argon2id hash, never the password.
    const [stored] = await harness.database.sql`SELECT email, password_hash FROM app_user`;
    const sealed = Buffer.from(stored?.["email"] as Uint8Array);
    expect(harness.cipher.open(sealed, Email.schema)).toBe("new.shopper@example.com");
    expect(sealed.toString("latin1")).not.toContain("new.shopper");
    expect(stored?.["password_hash"]).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(stored?.["password_hash"]).not.toContain(VALID_PASSWORD);

    // The first cart request as the new account takes the guest cart in and spends its cookie.
    const merged = await Shop.call(harness, "GET", "/cart", { ...guest, token: grant.accessToken });
    expect(jsonOf(merged)).toMatchObject({ itemCount: 3, subtotalCents: 17_000 });
    expect(merged.cookies.find((cookie) => cookie.name === "prism_cart")?.value).toBe("");

    // Signing out ends the session at once.
    const out = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${grant.accessToken}` },
    });
    expect(out.statusCode).toBe(204);
    expect(
      (
        await harness.app.inject({
          method: "GET",
          url: "/api/v1/auth/me",
          headers: { authorization: `Bearer ${grant.accessToken}` },
        })
      ).statusCode,
    ).toBe(401);

    // Signing in again, in any letter case, finds the same account and its cart.
    const back = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "NEW.SHOPPER@example.com", password: VALID_PASSWORD },
    });
    expect(back.statusCode).toBe(200);
    const again = (jsonOf(back)["grant"] as { accessToken: string }).accessToken;
    expect(jsonOf(await Shop.call(harness, "GET", "/cart", { token: again }))).toMatchObject({ itemCount: 3 });
  });

  it("cannot take an address that is already registered, in any letter case", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "NEW.shopper@example.com", password: VALID_PASSWORD, captchaToken: "widget-token" },
    });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "EmailAlreadyRegistered" });
  });

  it("needs the CAPTCHA, a valid address and a strong password, each named", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email: "not-an-address", password: "short", captchaToken: "" },
    });
    const paths = (jsonOf(response)["error"] as { issues: { path: string }[] }).issues.map((issue) => issue.path);

    expect(response.statusCode).toBe(422);
    expect(paths).toEqual(expect.arrayContaining(["email", "password", "captchaToken"]));
  });
});
