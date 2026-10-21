/**
 * What the storefront reads and the account keeps: the profile and saved
 * addresses, the checkout's prefill and billing address, the contact form,
 * the home page and categories, the similar-name fallback of search, what
 * search engines read, and the cache headers of all of it.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CHECKOUT, Shop } from "../support/commerce.ts";
import { emailIndexOf, jsonOf, registerUser, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "diamond-sword", name: "Diamond Sword", priceCents: 2500, category: "Weapons", ratings: [5, 5, 4] },
    { slug: "iron-sword", name: "Iron Sword", priceCents: 1500, category: "Weapons" },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12_000, category: "Furniture" },
  ]);
});

const address = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  label: "Home",
  fullName: "Mari Maasikas",
  phone: "+372 5123 4567",
  address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
  ...overrides,
});

describe("the profile and saved addresses", () => {
  it("keeps the name, phone and addresses sealed, and serves them opened", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com");
    const caller = { token: accessToken };

    const profile = await Shop.call(harness, "PUT", "/account/profile", caller, { fullName: "Mari Maasikas", phone: "+372 5123 4567" });
    await Shop.call(harness, "POST", "/account/addresses", caller, address());

    expect(jsonOf(profile)).toEqual({ email: "mari@example.com", fullName: "Mari Maasikas", phone: "+37251234567" });
    const [user] = await harness.database.sql`
      SELECT full_name, phone FROM app_user WHERE email_index = ${emailIndexOf(harness, "mari@example.com")}`;
    const [saved] = await harness.database.sql`SELECT details FROM address`;
    const stored = [user?.["full_name"], user?.["phone"], saved?.["details"]]
      .map((value) => Buffer.from(value as Uint8Array).toString("latin1"))
      .join("\n");
    for (const plaintext of ["Mari", "Maasikas", "51234567", "Narva", "Tallinn"]) expect(stored, plaintext).not.toContain(plaintext);

    expect(harness.cipher.open(Buffer.from(user?.["full_name"] as Uint8Array), z.string())).toBe("Mari Maasikas");
  });

  it("clears a profile field sent empty", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com");
    await Shop.call(harness, "PUT", "/account/profile", { token: accessToken }, { fullName: "Mari", phone: "+37251234567" });

    const cleared = await Shop.call(harness, "PUT", "/account/profile", { token: accessToken }, { fullName: "Mari", phone: "" });

    expect(jsonOf(cleared)).toEqual({ email: "mari@example.com", fullName: "Mari" });
  });

  it("stops at 10 addresses, and keeps exactly one default", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com");
    const caller = { token: accessToken };
    const ids: string[] = [];

    for (let index = 0; index < 10; index += 1) {
      const created = await Shop.call(harness, "POST", "/account/addresses", caller, address({ label: `Place ${index}`, isDefault: index === 4 }));
      expect(created.statusCode).toBe(201);
      ids.push(String(jsonOf(created)["id"]));
    }

    const eleventh = await Shop.call(harness, "POST", "/account/addresses", caller, address());
    expect(jsonOf(eleventh)["error"]).toMatchObject({ code: "AddressLimitReached" });

    await Shop.call(harness, "PUT", `/account/addresses/${ids[7] ?? ""}`, caller, address({ label: "Place 7", isDefault: true }));
    const { items } = jsonOf(await Shop.call(harness, "GET", "/account/addresses", caller)) as { items: { label: string; isDefault: boolean }[] };

    expect(items.filter((item) => item.isDefault).map((item) => item.label)).toEqual(["Place 7"]);
    expect(items[0]?.label).toBe("Place 7");
  });

  it("makes the first address the default", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com");

    const created = await Shop.call(harness, "POST", "/account/addresses", { token: accessToken }, address());

    expect(jsonOf(created)).toMatchObject({ isDefault: true });
  });

  it("will not read, change or delete another customer's address", async () => {
    const owner = await registerUser(harness, "owner@example.com");
    const other = await registerUser(harness, "other@example.com");
    const created = await Shop.call(harness, "POST", "/account/addresses", { token: owner.accessToken }, address());
    const id = String(jsonOf(created)["id"]);

    expect((await Shop.call(harness, "PUT", `/account/addresses/${id}`, { token: other.accessToken }, address({ label: "Mine" }))).statusCode).toBe(404);
    expect((await Shop.call(harness, "DELETE", `/account/addresses/${id}`, { token: other.accessToken })).statusCode).toBe(404);
    expect(jsonOf(await Shop.call(harness, "GET", "/account/addresses", { token: other.accessToken }))).toEqual({ items: [] });
    expect((jsonOf(await Shop.call(harness, "GET", "/account/addresses", { token: owner.accessToken }))["items"] as unknown[]).length).toBe(1);
  });
});

describe("checkout with an account", () => {
  it("prefills the profile first, then the default address, then the last order's method", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const caller = await Shop.fill(harness, [["diamond-sword", 1]], { token: accessToken });
    await Shop.place(harness, caller, { shippingMethod: "express", expectedTotalCents: await Shop.totalOf(harness, caller, "express") });

    await Shop.call(harness, "PUT", "/account/profile", { token: accessToken }, { fullName: "Kadri Tamm", phone: "+372 5555 1234" });
    await Shop.call(harness, "POST", "/account/addresses", { token: accessToken }, address({ address: { line1: "Pikk 1", city: "Tartu", postalCode: "51003", country: "EE" } }));

    expect(jsonOf(await Shop.call(harness, "GET", "/checkout/prefill", { token: accessToken }))).toEqual({
      email: "buyer@example.com",
      contact: { fullName: "Kadri Tamm", email: "mari@example.com", phone: "+37255551234" },
      address: { line1: "Pikk 1", city: "Tartu", postalCode: "51003", country: "EE" },
      shippingMethod: "express",
    });
  });

  it("keeps a separate billing address on the order, and saves the shipping address when asked", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");
    const caller = await Shop.fill(harness, [["diamond-sword", 1]], { token: accessToken });
    const billingAddress = { line1: "Rae 3", city: "Tartu", postalCode: "51004", country: "EE" };

    const placed = await Shop.place(harness, caller, { billingAddress, shouldSaveAddress: true });
    const orderId = String(jsonOf(placed)["orderId"]);

    expect(jsonOf(await Shop.call(harness, "GET", `/orders/${orderId}`, { token: accessToken }))).toMatchObject({ billingAddress });
    const { items } = jsonOf(await Shop.call(harness, "GET", "/account/addresses", { token: accessToken })) as { items: { address: object }[] };
    expect(items.map((item) => item.address)).toEqual([CHECKOUT.address]);

    // The same address again is not saved twice.
    const again = await Shop.fill(harness, [["iron-sword", 1]], { token: accessToken });
    await Shop.place(harness, again, { shouldSaveAddress: true });
    expect((jsonOf(await Shop.call(harness, "GET", "/account/addresses", { token: accessToken }))["items"] as unknown[]).length).toBe(1);
  });
});

describe("the contact form", () => {
  const message = {
    name: "Mari <b>Maasikas</b>",
    email: "mari@example.com",
    topic: "order",
    orderNumber: "100123",
    message: "Where is my parcel? <script>alert(1)</script>",
    captchaToken: "test-token",
  };

  it("emails the support inbox, with replies going to the sender, and a copy to the sender", async () => {
    const response = await Shop.call(harness, "POST", "/support/messages", {}, message);

    expect(response.statusCode).toBe(202);
    expect(harness.mailer.sent.map((email) => [email.to, email.replyTo])).toEqual([
      ["support@prism.test", "mari@example.com"],
      ["mari@example.com", undefined],
    ]);
    for (const email of harness.mailer.sent) {
      expect(email.html).not.toContain("<script>");
      expect(email.html).toContain("&lt;script&gt;");
      expect(email.text).toContain("Order: 100123");
    }
  });

  it("needs the CAPTCHA", async () => {
    const { captchaToken: _token, ...withoutCaptcha } = message;

    const response = await Shop.call(harness, "POST", "/support/messages", {}, withoutCaptcha);

    expect(response.statusCode).toBe(422);
    expect(harness.mailer.sent).toHaveLength(0);
  });
});

describe("the catalog's pages", () => {
  it("serves the home page's rows and the categories with counts", async () => {
    await harness.database.sql`UPDATE product SET featured_at = now() WHERE slug = 'oak-chair'`;

    const home = jsonOf(await Shop.call(harness, "GET", "/home")) as {
      featured: { slug: string }[];
      topRated: { slug: string }[];
      newest: unknown[];
      categories: { slug: string; productCount: number }[];
    };

    expect(home.featured.map((product) => product.slug)).toEqual(["oak-chair"]);
    expect(home.topRated.map((product) => product.slug)).toEqual(["diamond-sword"]);
    expect(home.newest).toHaveLength(3);
    expect(home.categories.map((category) => [category.slug, category.productCount])).toEqual([
      ["furniture", 1],
      ["weapons", 2],
    ]);
  });

  it("offers related products from the same category", async () => {
    const related = jsonOf(await Shop.call(harness, "GET", "/products/diamond-sword/related"));

    expect((related["items"] as { slug: string }[]).map((product) => product.slug)).toEqual(["iron-sword"]);
  });

  it("suggests products with their price and picture", async () => {
    await seedCatalog(harness, [{ slug: "diamond-pickaxe", name: "Diamond Pickaxe", priceCents: 3000, images: ["pickaxe.png"] }]);

    const suggest = jsonOf(await Shop.call(harness, "GET", "/products/suggest?q=diamond"));

    expect(suggest["items"]).toEqual([
      expect.objectContaining({ slug: "diamond-pickaxe", priceCents: 3000, image: expect.objectContaining({ url: "/media/pickaxe.png" }) }),
      expect.objectContaining({ slug: "diamond-sword", priceCents: 2500 }),
    ]);
  });

  it("falls back to similar names when nothing matches as typed, and says so", async () => {
    const typo = jsonOf(await Shop.call(harness, "GET", "/products?q=diamnd%20sword")) as { matched: string; items: { slug: string }[] };
    const exact = jsonOf(await Shop.call(harness, "GET", "/products?q=sword")) as { matched: string; items: unknown[] };

    expect(typo.matched).toBe("similar");
    expect(typo.items[0]?.slug).toBe("diamond-sword");
    expect(exact).toMatchObject({ matched: "exact" });
    expect(exact.items).toHaveLength(2);
  });

  it("sorts by newest", async () => {
    harness.clock.advanceSeconds(60);
    await seedCatalog(harness, [{ slug: "new-thing", name: "New Thing", priceCents: 500 }]);
    await harness.database.sql`UPDATE product SET created_at = now() + interval '1 day' WHERE slug = 'new-thing'`;

    const list = jsonOf(await Shop.call(harness, "GET", "/products?sort=newest")) as { items: { slug: string }[] };

    expect(list.items[0]?.slug).toBe("new-thing");
  });
});

describe("what search engines read", () => {
  it("lists every category and product with absolute addresses, and no private page", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/v1/seo/sitemap.xml" });
    const locations = [...response.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1] ?? "");

    expect(response.headers["content-type"]).toMatch(/^application\/xml/);
    expect(locations).toEqual(
      expect.arrayContaining([
        `${harness.config.http.webOrigin}/categories/weapons`,
        `${harness.config.http.webOrigin}/categories/furniture`,
        `${harness.config.http.webOrigin}/products/diamond-sword`,
        `${harness.config.http.webOrigin}/products/iron-sword`,
        `${harness.config.http.webOrigin}/products/oak-chair`,
      ]),
    );
    expect(locations.every((location) => location.startsWith("https://"))).toBe(true);
    for (const path of ["/cart", "/checkout", "/account", "/admin", "/orders"]) {
      expect(locations.some((location) => location.includes(path))).toBe(false);
    }
  });

  it("keeps crawlers out of private pages and names the sitemap", async () => {
    const response = await harness.app.inject({ method: "GET", url: "/api/v1/seo/robots.txt" });

    expect(response.body).toContain("Disallow: /admin");
    expect(response.body).toContain("Disallow: /checkout");
    expect(response.body).toContain(`Sitemap: ${harness.config.http.webOrigin}/sitemap.xml`);
  });
});

describe("cache headers", () => {
  it("lets anyone keep an anonymous catalog read for a minute, and nobody keep a personal one", async () => {
    const { accessToken } = await registerUser(harness, "reader@example.com");

    const anonymous = await Shop.call(harness, "GET", "/products");
    const signedIn = await Shop.call(harness, "GET", "/products", { token: accessToken });
    const personal = await Shop.call(harness, "GET", "/auth/me", { token: accessToken });

    expect(anonymous.headers["cache-control"]).toBe("public, max-age=60, stale-while-revalidate=300");
    expect(signedIn.headers["cache-control"]).toBe("private, no-store");
    expect(personal.headers["cache-control"]).toBe("private, no-store");
  });
});

describe("encryption at rest of what the account adds", () => {
  it("seals the billing address of an order", async () => {
    const guest = await Shop.fill(harness, [["diamond-sword", 1]]);
    await Shop.place(harness, guest, { billingAddress: { line1: "Rae 3", city: "Tartu", postalCode: "51004", country: "EE" } });

    const [row] = await harness.database.sql`SELECT billing_address FROM customer_order`;

    expect(Buffer.from(row?.["billing_address"] as Uint8Array).toString("latin1")).not.toContain("Rae");
  });
});
