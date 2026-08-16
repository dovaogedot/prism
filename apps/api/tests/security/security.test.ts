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
import { buildApp } from "../../src/app.ts";
import { toConfig } from "../../src/config.ts";
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
  "'; UPDATE app_user SET role='admin'; --",
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
      { slug: "screaming-pumpkin", name: "Screaming Pumpkin", hex: "#ff8800", priceCents: 1899 },
    ]);
  });

  it("rejects payloads in slug-shaped parameters", async () => {
    for (const payload of SQL_PAYLOADS) {
      for (const parameter of ["category", "brands", "finishes"]) {
        const response = await get(
          `/api/v1/products?${parameter}=${encodeURIComponent(payload)}`,
        );

        expect([400, 422], `${parameter}=${payload}`).toContain(response.statusCode);
      }
    }
  });

  it("rejects payloads in numeric parameters", async () => {
    for (const parameter of ["priceMin", "priceMax", "hueMin", "page", "perPage"]) {
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
    // rejected — the protection is parameterisation, not a blocklist.
    for (const payload of SQL_PAYLOADS) {
      const response = await get(`/api/v1/products?q=${encodeURIComponent(payload)}`);

      expect(response.statusCode, payload).toBe(200);
      expect(jsonOf(response)["total"]).toBe(0);
    }
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
    const { sql } = harness.database;

    await sql`
      INSERT INTO category (slug, name, kind, parent_id)
      SELECT 'reds', 'Reds', 'color', id FROM category WHERE slug = 'color'
    `;
    await sql`INSERT INTO brand (slug, name) VALUES ('chroma-labs', 'Chroma Labs')`;

    for (const [index, payload] of XSS_PAYLOADS.entries()) {
      await sql`
        INSERT INTO product (slug, name, description, price_cents, category_id, brand_id, kind, hex, finish)
        SELECT ${`xss-${index}`}, ${payload}, ${payload}, 1000, c.id, b.id, 'color', '#ff0000', 'matte'
        FROM category c, brand b WHERE c.slug = 'reds' AND b.slug = 'chroma-labs'
      `;
    }

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
    const forged = await new SignJWT({ sub: "x", sid: "y", role: "admin", jti: "z" })
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
      JSON.stringify({ sub: "x", sid: "y", role: "admin", jti: "z", exp: 4102444800 }),
    ).toString("base64url");

    expect((await attempt(`${header}.${payload}.`)).statusCode).toBe(401);
  });

  it("refuses a correctly signed token for a session that never existed", async () => {
    // Signature valid, issuer valid, audience valid — but the session id
    // resolves to nothing, so the guard's database check refuses it.
    const invented = await new SignJWT({
      sub: "00000000-0000-4000-8000-000000000000",
      sid: "11111111-1111-4111-8111-111111111111",
      role: "admin",
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
    const wrongIssuer = await new SignJWT({ sub: "x", sid: "y", role: "customer", jti: "z" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("somebody-else")
      .setAudience("access")
      .setExpirationTime("1h")
      .sign(secret);

    expect((await attempt(wrongIssuer)).statusCode).toBe(401);
  });
});

describe("privilege escalation", () => {
  it("ignores a role supplied at registration", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: {
        email: "sneaky@example.com",
        password: VALID_PASSWORD,
        captchaToken: "t",
        role: "admin",
      },
    });

    expect(response.statusCode).toBe(201);

    const rows = await harness.database
      .sql<{ role: string }[]>`SELECT role FROM app_user WHERE email = 'sneaky@example.com'`;

    expect(rows[0]?.role).toBe("customer");
  });

  it("refuses an admin endpoint to a customer", async () => {
    const { accessToken } = await registerUser(harness, "customer@example.com");

    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/admin/products/anything/images",
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it("refuses an admin endpoint to an anonymous caller", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/admin/products/anything/images",
    });

    expect(response.statusCode).toBe(401);
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
  it("refuses any filename that is not a content hash", async () => {
    const attempts = [
      "..%2f..%2fetc%2fpasswd",
      "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
      "....%2f%2f....%2f%2fetc%2fpasswd",
      "abc.png",
      `${"a".repeat(64)}.exe`,
      `${"z".repeat(64)}.png`,
      "..%00.png",
    ];

    for (const attempt of attempts) {
      const response = await get(`/media/${attempt}`);
      expect([400, 404, 422], attempt).toContain(response.statusCode);
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
    throttled = await buildApp({
      config: toConfig(
        testEnvironment(
          harness.config.database.url,
          harness.mediaDirectory,
          LIMIT,
        ),
      ),
      database: harness.database,
      overrides: { clock: harness.clock, mailer: harness.mailer },
    });
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

  it("budgets each client address separately", async () => {
    for (let index = 0; index < LIMIT + 3; index += 1) {
      await attempt("203.0.113.11");
    }

    // One noisy address must not lock everybody else out.
    expect((await attempt("203.0.113.12")).statusCode).not.toBe(429);
  });
});
