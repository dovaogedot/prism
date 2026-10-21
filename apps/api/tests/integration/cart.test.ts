/**
 * The cart over a real Postgres: guest carts found by their cookie, user
 * carts that survive signing out, the merge when a guest signs in, stock
 * limits, expiry, and recommendations.
 */

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { products } from "../../src/db/schema.ts";
import {
  cookieValue,
  jsonOf,
  registerUser,
  seedCatalog,
  startHarness,
  VALID_PASSWORD,
  type Harness,
} from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5, category: "Lighting", images: ["lamp.png"], ratings: [4] },
    { slug: "floor-lamp", name: "Floor Lamp", priceCents: 8000, stock: 3, category: "Lighting", ratings: [5] },
    { slug: "wall-lamp", name: "Wall Lamp", priceCents: 4000, stock: 0, category: "Lighting", ratings: [5] },
    { slug: "oak-chair", name: "Oak Chair", priceCents: 12000, stock: 2, category: "Furniture", ratings: [5] },
  ]);
});

const idOf = async (slug: string): Promise<string> => {
  const [row] = await harness.database.db.select({ id: products.id }).from(products).where(eq(products.slug, slug as never));
  if (row === undefined) throw new Error(`no product ${slug}`);
  return row.id;
};

type Caller = Readonly<{ guest?: string; token?: string }>;

const request = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, caller: Caller = {}, payload?: object) =>
  harness.app.inject({
    method,
    url: `/api/v1${url}`,
    ...(payload === undefined ? {} : { payload }),
    ...(caller.guest === undefined ? {} : { cookies: { prism_cart: caller.guest } }),
    ...(caller.token === undefined ? {} : { headers: { authorization: `Bearer ${caller.token}` } }),
  });

type View = { lines: { slug: string; quantity: number; lineTotalCents: number; image?: { url: string } }[]; itemCount: number; subtotalCents: number };

const viewOf = (response: { body: string }) => JSON.parse(response.body) as View;

/** Adds a product as a guest who has no cart yet, and hands back the cookie it got. */
const guestWith = async (slug: string, quantity: number): Promise<string> => {
  const response = await request("POST", "/cart/items", {}, { productId: await idOf(slug), quantity });
  expect(response.statusCode).toBe(200);
  return cookieValue(response, "prism_cart");
};

const signIn = async (email: string): Promise<string> => {
  const response = await harness.app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    payload: { email, password: VALID_PASSWORD },
  });
  const grant = jsonOf(response)["grant"] as { accessToken: string };
  return grant.accessToken;
};

describe("guest cart", () => {
  it("is empty and sets no cookie before the first write", async () => {
    const response = await request("GET", "/cart");

    expect(viewOf(response)).toEqual({ lines: [], itemCount: 0, subtotalCents: 0 });
    expect(response.cookies).toHaveLength(0);
  });

  it("is created on the first add, behind an httpOnly cookie scoped to the API", async () => {
    const response = await request("POST", "/cart/items", {}, { productId: await idOf("desk-lamp"), quantity: 2 });
    const cookie = response.cookies.find((candidate) => candidate.name === "prism_cart");

    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/api/v1" });
    expect(viewOf(response)).toMatchObject({ itemCount: 2, subtotalCents: 5000 });
  });

  it("survives across requests by its cookie, with name, price and thumbnail", async () => {
    const guest = await guestWith("desk-lamp", 2);
    const view = viewOf(await request("GET", "/cart", { guest }));

    expect(view.lines).toEqual([
      {
        productId: await idOf("desk-lamp"),
        slug: "desk-lamp",
        name: "Desk Lamp",
        image: { id: expect.any(String), url: "/media/lamp.png", alt: "Desk Lamp", isPixelArt: false, sources: [] },
        unitPriceCents: 2500,
        quantity: 2,
        stock: 5,
        lineTotalCents: 5000,
      },
    ]);
  });

  it("stores only a digest of the cookie", async () => {
    const guest = await guestWith("desk-lamp", 1);
    const rows = await harness.database.sql`SELECT token_hash FROM cart`;

    expect(rows[0]?.["token_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.["token_hash"]).not.toBe(guest);
  });

  it("is not found once it has expired, and its cookie is cleared", async () => {
    const guest = await guestWith("desk-lamp", 1);
    harness.clock.advanceSeconds(harness.config.commerce.guestCartTtlSeconds + 1);

    const response = await request("GET", "/cart", { guest });

    expect(viewOf(response).lines).toEqual([]);
    expect(response.cookies.find((cookie) => cookie.name === "prism_cart")?.value).toBe("");
  });

  it("lives longer with every write", async () => {
    const guest = await guestWith("desk-lamp", 1);
    harness.clock.advanceSeconds(harness.config.commerce.guestCartTtlSeconds - 60);
    await request("POST", "/cart/items", { guest }, { productId: await idOf("floor-lamp"), quantity: 1 });
    harness.clock.advanceSeconds(120);

    expect(viewOf(await request("GET", "/cart", { guest })).itemCount).toBe(2);
  });

  it("is deleted by housekeeping once expired", async () => {
    await guestWith("desk-lamp", 1);
    harness.clock.advanceSeconds(harness.config.commerce.guestCartTtlSeconds + 1);

    expect((await harness.jobs.housekeeping.run()).cartsDeleted).toBe(1);
    expect(await harness.database.sql`SELECT id FROM cart`).toHaveLength(0);
  });

  it("ignores a cookie that is not one of ours", async () => {
    const response = await request("GET", "/cart", { guest: "forged" });
    expect(viewOf(response).lines).toEqual([]);
  });
});

describe("changing lines", () => {
  it("adds to a line, sets it, and removes it, with live totals each time", async () => {
    const guest = await guestWith("desk-lamp", 1);
    const lamp = await idOf("desk-lamp");
    const chair = await idOf("oak-chair");

    expect(viewOf(await request("POST", "/cart/items", { guest }, { productId: lamp, quantity: 2 }))).toMatchObject({
      itemCount: 3,
      subtotalCents: 7500,
    });
    expect(viewOf(await request("POST", "/cart/items", { guest }, { productId: chair }))).toMatchObject({
      itemCount: 4,
      subtotalCents: 19_500,
    });
    expect(viewOf(await request("PUT", `/cart/items/${lamp}`, { guest }, { quantity: 1 }))).toMatchObject({
      itemCount: 2,
      subtotalCents: 14_500,
    });
    expect(viewOf(await request("DELETE", `/cart/items/${chair}`, { guest }))).toMatchObject({
      itemCount: 1,
      subtotalCents: 2500,
    });
  });

  it("answers the cart when removing a line that is not there", async () => {
    const guest = await guestWith("desk-lamp", 1);
    const response = await request("DELETE", `/cart/items/${await idOf("oak-chair")}`, { guest });

    expect(response.statusCode).toBe(200);
    expect(viewOf(response).itemCount).toBe(1);
  });

  it("refuses a sold-out product, saying so", async () => {
    const wall = await idOf("wall-lamp");
    const response = await request("POST", "/cart/items", {}, { productId: wall, quantity: 1 });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({
      code: "OutOfStock",
      issues: [{ path: wall, message: "Sold out." }],
    });
    // A refused add creates no cart, so there is no cookie to hand out.
    expect(response.cookies).toHaveLength(0);
    expect(await harness.database.sql`SELECT id FROM cart`).toHaveLength(0);
  });

  it("refuses more than the stock, naming how many are left", async () => {
    const guest = await guestWith("oak-chair", 2);
    const chair = await idOf("oak-chair");

    const added = await request("POST", "/cart/items", { guest }, { productId: chair, quantity: 1 });
    const set = await request("PUT", `/cart/items/${chair}`, { guest }, { quantity: 3 });

    for (const response of [added, set]) {
      expect(response.statusCode).toBe(409);
      expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: chair, message: "Only 2 left." }] });
    }
    expect(viewOf(await request("GET", "/cart", { guest })).itemCount).toBe(2);
  });

  it("answers 404 for a product that does not exist", async () => {
    const response = await request("POST", "/cart/items", {}, { productId: "00000000-0000-4000-8000-000000000000" });

    expect(response.statusCode).toBe(404);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ProductNotFound" });
  });

  it("refuses a quantity outside 1 to 99", async () => {
    const lamp = await idOf("desk-lamp");

    expect((await request("POST", "/cart/items", {}, { productId: lamp, quantity: 0 })).statusCode).toBe(422);
    expect((await request("PUT", `/cart/items/${lamp}`, {}, { quantity: 100 })).statusCode).toBe(422);
  });
});

describe("signed-in cart", () => {
  it("survives signing out and back in", async () => {
    const { accessToken } = await registerUser(harness, "shopper@example.com");
    await request("POST", "/cart/items", { token: accessToken }, { productId: await idOf("floor-lamp"), quantity: 2 });

    await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const again = await signIn("shopper@example.com");

    expect(viewOf(await request("GET", "/cart", { token: again }))).toMatchObject({ itemCount: 2, subtotalCents: 16_000 });
  });

  it("takes in the guest cart on the first signed-in request, capped at stock, and clears the cookie", async () => {
    const { accessToken } = await registerUser(harness, "shopper@example.com");
    await request("POST", "/cart/items", { token: accessToken }, { productId: await idOf("oak-chair"), quantity: 1 });

    const guest = await guestWith("oak-chair", 2);
    await request("POST", "/cart/items", { guest }, { productId: await idOf("desk-lamp"), quantity: 1 });

    const response = await request("GET", "/cart", { guest, token: accessToken });
    const view = viewOf(response);

    expect(view.lines.map((line) => [line.slug, line.quantity])).toEqual([
      ["oak-chair", 2],
      ["desk-lamp", 1],
    ]);
    expect(response.cookies.find((cookie) => cookie.name === "prism_cart")?.value).toBe("");
    expect(await harness.database.sql`SELECT id FROM cart WHERE user_id IS NULL`).toHaveLength(0);
  });

  it("refuses a bad bearer token instead of treating the caller as a guest", async () => {
    const response = await request("GET", "/cart", { token: "not-a-token" });
    expect(response.statusCode).toBe(401);
  });
});

describe("GET /cart/recommendations", () => {
  type Items = { items: { slug: string }[] };

  it("leaves out what is in the cart and what is sold out, and puts the same category first", async () => {
    const guest = await guestWith("desk-lamp", 1);
    const body = jsonOf(await request("GET", "/cart/recommendations", { guest })) as unknown as Items;

    expect(body.items.map((item) => item.slug)).toEqual(["floor-lamp", "oak-chair"]);
  });

  it("offers the best rated in-stock products to an empty cart", async () => {
    const body = jsonOf(await request("GET", "/cart/recommendations")) as unknown as Items;

    expect(body.items.map((item) => item.slug)).toEqual(["floor-lamp", "oak-chair", "desk-lamp"]);
  });
});
