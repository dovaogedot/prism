/**
 * Security tests.
 *
 * Injection and malformed input, against the running application and a real
 * database — so a payload that got through would actually do damage, and the
 * assertions afterwards check that it did not.
 */

import type { FastifyInstance } from "fastify";
import { SignJWT } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/app.ts";
import { Config } from "../../src/config.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { MessageQueue } from "../../src/platform/queue.ts";
import { CHECKOUT, Shop } from "../support/commerce.ts";
import {
  jsonOf,
  registerUser,
  seedCatalog,
  startHarness,
  testEnvironment,
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

const get = (url: string) => harness.app.inject({ method: "GET", url });

const SQL_PAYLOADS = [
  "'; DROP TABLE product; --",
  "' OR '1'='1",
  "' OR 1=1 --",
  "1; DELETE FROM app_user",
  "' UNION SELECT password_hash FROM app_user --",
  "admin'--",
  "'; UPDATE app_user SET password_hash=''; --",
  "\\'; DROP TABLE product; --",
  "%27%20OR%20%271%27%3D%271",
];

const XSS_PAYLOADS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  "javascript:alert(1)",
  "\"><script>alert(1)</script>",
  "<svg/onload=alert(1)>",
];

describe("SQL injection through catalog filters", () => {
  beforeEach(async () => {
    await seedCatalog(harness, [
      { slug: "desk-lamp", name: "Desk Lamp", priceCents: 1899, properties: { color: "red" } },
    ]);
  });

  it("rejects payloads in slug-shaped parameters", async () => {
    for (const payload of SQL_PAYLOADS) {
      for (const parameter of ["category", "brand"]) {
        const response = await get(
          `/api/v1/products?${parameter}=${encodeURIComponent(payload)}`,
        );

        expect([400, 422], `${parameter}=${payload}`).toContain(response.statusCode);
      }
    }
  });

  it("rejects payloads in numeric parameters", async () => {
    for (const parameter of ["priceMin", "priceMax", "rating", "page", "perPage"]) {
      const response = await get(
        `/api/v1/products?${parameter}=${encodeURIComponent("1; DROP TABLE product")}`,
      );

      expect([400, 422], parameter).toContain(response.statusCode);
    }
  });

  it("rejects an injected sort direction", async () => {
    for (const payload of ["price_asc; DROP TABLE product", "1", "'", "../"]) {
      const response = await get(`/api/v1/products?sort=${encodeURIComponent(payload)}`);
      expect([400, 422], payload).toContain(response.statusCode);
    }
  });

  it("treats a payload in the free-text search as a search term", async () => {
    // `q` is genuinely free text, so it must be accepted and bound, not
    // rejected — the protection is parameterization, not a blocklist.
    for (const payload of SQL_PAYLOADS) {
      const response = await get(`/api/v1/products?q=${encodeURIComponent(payload)}`);

      expect(response.statusCode, payload).toBe(200);
      expect(jsonOf(response)["total"]).toBe(0);
    }
  });

  it("treats a payload in a property filter as a value to look for", async () => {
    for (const payload of SQL_PAYLOADS) {
      const response = await get(`/api/v1/products?p.color=${encodeURIComponent(payload)}`);

      expect(response.statusCode, payload).toBe(200);
      expect(jsonOf(response)["total"]).toBe(0);
    }

    const matching = await get("/api/v1/products?p.color=red");
    expect(jsonOf(matching)["total"]).toBe(1);
  });

  it("leaves every table standing afterwards", async () => {
    const products = await harness.database.sql`SELECT count(*)::int AS n FROM product`;
    const users = await harness.database.sql`SELECT count(*)::int AS n FROM app_user`;

    expect(products[0]?.["n"]).toBe(1);
    expect(users[0]?.["n"]).toBe(0);
  });

  it("does not leak database internals when input is rejected", async () => {
    const response = await get("/api/v1/products?category=%27%20OR%201%3D1");
    const body = response.body.toLowerCase();

    for (const leak of ["postgres", "syntax error", "relation", "pg_", "at position"]) {
      expect(body, leak).not.toContain(leak);
    }
  });
});

describe("SQL injection through authentication", () => {
  it("does not sign anyone in with an injected email", async () => {
    await registerUser(harness, "victim@example.com");

    for (const payload of SQL_PAYLOADS) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: payload, password: VALID_PASSWORD },
      });

      expect([401, 422], payload).toContain(response.statusCode);
      expect(response.body).not.toContain("accessToken");
    }
  });

  it("does not accept an injected password", async () => {
    await registerUser(harness, "victim@example.com");

    for (const payload of SQL_PAYLOADS) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "victim@example.com", password: payload },
      });

      expect(response.statusCode, payload).toBe(401);
    }
  });
});

describe("cross-site scripting", () => {
  it("stores and returns markup as inert text, never as HTML", async () => {
    await seedCatalog(
      harness,
      XSS_PAYLOADS.map((payload, index) => ({
        slug: `xss-${index}`,
        name: payload,
        description: payload,
        priceCents: 1000,
        properties: { note: payload },
      })),
    );

    const response = await get("/api/v1/products/xss-0");

    // JSON, not HTML: the angle brackets are escaped by the serializer and the
    // content type tells the browser not to parse it as a document.
    expect(response.headers["content-type"]).toContain("application/json");
    expect(jsonOf(response)["name"]).toBe(XSS_PAYLOADS[0]);
  });

  it("sends nosniff so a JSON response is never sniffed into HTML", async () => {
    const response = await get("/api/v1/products");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("refuses to be framed", async () => {
    const response = await get("/api/v1/products");
    expect(response.headers["x-frame-options"]).toBe("DENY");
  });
});

describe("JWT tampering", () => {
  const secret = new TextEncoder().encode(
    "test-secret-that-is-at-least-32-characters-long",
  );

  const attempt = (token: string) =>
    harness.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

  it("refuses a token signed with the wrong key", async () => {
    const forged = await new SignJWT({ sub: "x", sid: "y", jti: "z" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("prism")
      .setAudience("access")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("z".repeat(48)));

    expect((await attempt(forged)).statusCode).toBe(401);
  });

  it("refuses an unsigned token claiming alg none", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url",
    );
    const payload = Buffer.from(
      JSON.stringify({ sub: "x", sid: "y", jti: "z", exp: 4102444800 }),
    ).toString("base64url");

    expect((await attempt(`${header}.${payload}.`)).statusCode).toBe(401);
  });

  it("refuses a correctly signed token for a session that never existed", async () => {
    // Signature valid, issuer valid, audience valid — but the session id
    // resolves to nothing, so the guard's database check refuses it.
    const invented = await new SignJWT({
      sub: "00000000-0000-4000-8000-000000000000",
      sid: "11111111-1111-4111-8111-111111111111",
      jti: "22222222-2222-4222-8222-222222222222",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("prism")
      .setAudience("access")
      .setExpirationTime("1h")
      .sign(secret);

    expect((await attempt(invented)).statusCode).toBe(401);
  });

  it("refuses a token with the wrong issuer", async () => {
    const wrongIssuer = await new SignJWT({ sub: "x", sid: "y", jti: "z" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("somebody-else")
      .setAudience("access")
      .setExpirationTime("1h")
      .sign(secret);

    expect((await attempt(wrongIssuer)).statusCode).toBe(401);
  });
});

describe("mass assignment", () => {
  it("drops fields the registration schema does not declare", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "sneaky@example.com",
        password: VALID_PASSWORD,
        captchaToken: "t",
        role: "admin",
        id: "00000000-0000-4000-8000-000000000000",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(jsonOf(response)["user"]).not.toHaveProperty("role");
    expect(jsonOf(response)["user"]).not.toMatchObject({ id: "00000000-0000-4000-8000-000000000000" });
  });
});

describe("malformed input", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{not json at all",
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it("rejects wrong types where a string is expected", async () => {
    for (const email of [12345, null, [], { nested: true }, true]) {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email, password: VALID_PASSWORD },
      });

      expect(response.statusCode, JSON.stringify(email)).toBe(422);
    }
  });

  it("rejects an oversized body rather than buffering it", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "a@example.com",
        password: "x".repeat(2 * 1024 * 1024),
        captchaToken: "t",
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it("rejects a deeply nested body without stack overflow", async () => {
    let nested: Record<string, unknown> = { end: true };
    for (let depth = 0; depth < 5000; depth += 1) nested = { nested };

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: nested,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.statusCode).toBeLessThan(500);
  });

  it("survives null bytes in a search term", async () => {
    const response = await get("/api/v1/products?q=red%00blue");
    expect(response.statusCode).toBeLessThan(500);
  });

  it("rejects an over-long search term", async () => {
    const response = await get(`/api/v1/products?q=${"a".repeat(500)}`);
    expect(response.statusCode).toBe(422);
  });
});

describe("path traversal in media", () => {
  it("serves nothing outside the media directory", async () => {
    const attempts = [
      "..%2f..%2fetc%2fpasswd",
      "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "....%2f%2f....%2f%2fetc%2fpasswd",
      "..%00.png",
      ".env",
      "missing.svg",
    ];

    for (const attempt of attempts) {
      const response = await get(`/media/${attempt}`);
      expect([400, 403, 404, 422], attempt).toContain(response.statusCode);
      expect(response.body).not.toContain("root:");
    }
  });
});

/**
 * The shared harness runs with throttling effectively disabled, because the
 * limiter keys on the client address and cannot tell one test from the next.
 * These build a second application over the same database with a real budget.
 */
describe("rate limiting", () => {
  const LIMIT = 5;
  let throttled: FastifyInstance;

  beforeAll(async () => {
    const built = await App.build({
      config: Config.fromEnvironment(testEnvironment(harness.config.database.url, harness.mediaDirectory, LIMIT)),
      database: harness.database,
      overrides: { clock: harness.clock, mailer: harness.mailer, queue: MessageQueue.memory(Topology.declarations()) },
    });
    throttled = built.app;
  });

  afterAll(async () => {
    await throttled.close();
  });

  const attempt = (address: string) =>
    throttled.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "target@example.com", password: "guess number one here" },
      headers: { "x-forwarded-for": address },
    });

  it("lets the budget through and then refuses", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < LIMIT + 3; index += 1) {
      statuses.push((await attempt("203.0.113.9")).statusCode);
    }

    expect(statuses.slice(0, LIMIT).every((status) => status !== 429)).toBe(true);
    expect(statuses).toContain(429);
  });

  it("reports throttling with the documented error code", async () => {
    for (let index = 0; index < LIMIT + 3; index += 1) {
      await attempt("203.0.113.10");
    }

    const refused = await attempt("203.0.113.10");

    expect(refused.statusCode).toBe(429);
    expect(jsonOf(refused)["error"]).toMatchObject({ code: "RateLimited" });
  });

  it("ignores a forwarded address the caller made up", async () => {
    // The whole point of the budget is that it cannot be reset at will. With
    // the entire X-Forwarded-For chain trusted, a caller could name a new
    // address on every request and never spend the same budget twice; the
    // address that counts is the one no proxy on this network vouched for.
    const spoofed = (claimed: string) =>
      throttled.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "target@example.com", password: "guess number one here" },
        // A public address, so nothing about this request is trusted.
        remoteAddress: "198.51.100.7",
        headers: { "x-forwarded-for": claimed },
      });

    const statuses: number[] = [];

    for (let index = 0; index < LIMIT + 3; index += 1) {
      statuses.push((await spoofed(`203.0.113.${120 + index}`)).statusCode);
    }

    expect(statuses).toContain(429);
  });

  it("budgets each client address separately", async () => {
    for (let index = 0; index < LIMIT + 3; index += 1) {
      await attempt("203.0.113.11");
    }

    // One noisy address must not lock everybody else out.
    expect((await attempt("203.0.113.12")).statusCode).not.toBe(429);
  });
});

describe("payment webhooks", () => {
  beforeEach(async () => {
    await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }]);
  });

  const deliver = (payload: string, signature: string) =>
    harness.app.inject({
      method: "POST",
      url: "/api/v1/payments/webhook",
      headers: { "content-type": "application/json", "stripe-signature": signature },
      payload,
    });

  it("refuses an event signed with another secret", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    const payload = JSON.stringify({ id: "evt_forged", object: "event", type: "payment_intent.succeeded", data: { object: Shop.intent(placed.charge) } });
    const timestamp = Math.floor(Date.now() / 1000);
    const { createHmac } = await import("node:crypto");
    const forged = createHmac("sha256", "whsec_someone_else").update(`${timestamp}.${payload}`).digest("hex");

    const response = await deliver(payload, `t=${timestamp},v1=${forged}`);

    expect(response.statusCode).toBe(400);
    await harness.settle();
    expect(harness.mailer.sent).toHaveLength(0);
  });

  it("refuses a correctly signed event replayed after the tolerance window", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    const { payload, signature } = harness.gateway.sign({
      type: "payment_intent.succeeded",
      object: Shop.intent(placed.charge),
      timestamp: Math.floor(Date.now() / 1000) - 600,
    });

    expect((await deliver(payload, signature)).statusCode).toBe(400);
  });

  it("acts once on a fresh event delivered again", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    const { payload, signature } = harness.gateway.sign({ type: "payment_intent.succeeded", object: Shop.intent(placed.charge) });

    expect((await deliver(payload, signature)).statusCode).toBe(200);
    expect((await deliver(payload, signature)).statusCode).toBe(200);
    await harness.settle();

    expect(harness.mailer.sent).toHaveLength(1);
  });
});

describe("orders of other customers", () => {
  beforeEach(async () => {
    await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }]);
  });

  it("cannot be read or canceled by id, by another account or by a guest", async () => {
    const owner = await registerUser(harness, "owner@example.com");
    const intruder = await registerUser(harness, "intruder@example.com");
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: owner.accessToken }));

    for (const caller of [{ token: intruder.accessToken }, {}]) {
      expect((await Shop.call(harness, "GET", `/orders/${placed.orderId}`, caller)).statusCode).toBe(404);
      expect((await Shop.call(harness, "POST", `/orders/${placed.orderId}/cancel`, caller)).statusCode).toBe(404);
    }

    const list = jsonOf(await Shop.call(harness, "GET", "/orders", { token: intruder.accessToken }));
    expect(list["total"]).toBe(0);
    expect((jsonOf(await Shop.call(harness, "GET", `/orders/${placed.orderId}`, { token: owner.accessToken })))["status"]).toBe(
      "pending_payment",
    );
  });

  it("cannot be opened with another order's key", async () => {
    const first = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));
    const second = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]]));

    expect((await Shop.call(harness, "GET", `/orders/${first.orderId}?key=${second.key}`)).statusCode).toBe(404);
  });

  it("cannot be read through someone else's cart cookie", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 2]]);
    const stranger = await Shop.fill(harness, [["desk-lamp", 1]]);

    expect(jsonOf(await Shop.call(harness, "GET", "/cart", stranger))["itemCount"]).toBe(1);
    expect(jsonOf(await Shop.call(harness, "GET", "/cart", guest))["itemCount"]).toBe(2);
  });
});

describe("money in request bodies", () => {
  beforeEach(async () => {
    await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }]);
  });

  it("refuses a price or amount sent with a cart change or an order", async () => {
    const productId = await Shop.productId(harness, "desk-lamp");
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const total = await Shop.totalOf(harness, guest);
    const order = { ...CHECKOUT, shippingMethod: "standard", expectedTotalCents: total };

    for (const [url, payload] of [
      ["/cart/items", { productId, quantity: 1, priceCents: 1 }],
      ["/orders", { ...order, totalCents: 1 }],
      ["/orders", { ...order, lines: [{ productId, quantity: 1, unitPriceCents: 1 }] }],
    ] as const) {
      const response = await Shop.call(harness, "POST", url, guest, payload);
      expect(response.statusCode, `${url} ${JSON.stringify(payload)}`).toBe(422);
    }

    expect(harness.gateway.calls.createIntent).toHaveLength(0);
  });

  it("charges the server's price whatever total the browser claims", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const response = await Shop.place(harness, guest, { expectedTotalCents: 1 });

    expect(response.statusCode).toBe(409);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "CartChanged" });
    expect(harness.gateway.calls.createIntent).toHaveLength(0);
  });

  it("accepts no card field at all, so card data cannot reach the server", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);

    for (const field of [{ cardNumber: "4242424242424242" }, { card: { number: "4242424242424242", cvc: "123" } }, { cvc: "123" }]) {
      const response = await Shop.place(harness, guest, field);
      expect(response.statusCode, JSON.stringify(field)).toBe(422);
    }
  });
});

describe("SQL injection through cart and order parameters", () => {
  it("rejects payloads in the order filters", async () => {
    const { accessToken } = await registerUser(harness, "buyer@example.com");

    for (const payload of SQL_PAYLOADS) {
      for (const parameter of ["status", "from", "to", "sort", "page"]) {
        const response = await Shop.call(harness, "GET", `/orders?${parameter}=${encodeURIComponent(payload)}`, {
          token: accessToken,
        });

        expect([400, 422], `${parameter}=${payload}`).toContain(response.statusCode);
      }
    }
  });

  it("rejects payloads in product and order ids", async () => {
    for (const payload of SQL_PAYLOADS) {
      const encoded = encodeURIComponent(payload);

      expect([400, 404, 422], payload).toContain((await Shop.call(harness, "DELETE", `/cart/items/${encoded}`)).statusCode);
      expect([400, 404, 422], payload).toContain((await Shop.call(harness, "GET", `/orders/${encoded}`)).statusCode);
      expect([400, 422], payload).toContain(
        (await Shop.call(harness, "POST", "/cart/items", {}, { productId: payload, quantity: 1 })).statusCode,
      );
    }

    expect(await harness.database.sql`SELECT count(*)::int AS n FROM app_user`).toEqual([{ n: 0 }]);
  });

  it("stores markup in the address as text and never runs it", async () => {
    await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }]);
    const guest = await Shop.fill(harness, [["desk-lamp", 1]]);
    const hostile = "Robert'); DROP TABLE customer_order; --";

    const placed = await Shop.place(harness, guest, { contact: { ...CHECKOUT.contact, fullName: hostile } });
    expect(placed.statusCode).toBe(201);

    const body = jsonOf(placed) as { orderId: string; key: string };
    const order = jsonOf(await Shop.call(harness, "GET", `/orders/${body.orderId}?key=${body.key}`));
    expect((order["contact"] as { fullName: string }).fullName).toBe(hostile);
  });
});

describe("markup in order emails", () => {
  it("escapes a product name in every email it appears in", async () => {
    for (const payload of XSS_PAYLOADS) {
      await harness.reset();
      const slug = "hostile";
      await seedCatalog(harness, [{ slug, name: payload, priceCents: 2500, stock: 5 }]);

      const placed = await Shop.placed(harness, await Shop.fill(harness, [[slug, 1]]));
      await Shop.succeed(harness, placed.charge);
      await harness.settle();

      const html = harness.mailer.sent.map((email) => email.html).join("\n");
      expect(harness.mailer.sent, payload).toHaveLength(1);
      // Escaped, the payload is text: no tag it carried survives as a tag.
      expect(html, payload).not.toMatch(/<(script|img|svg)/i);
      if (payload.includes("<")) expect(html, payload).toContain("&lt;");
    }
  });
});

