/**
 * The stack the suite runs against: the accounts it knows, and the API calls
 * that set up what a page needs, such as a signed-in customer or a cart.
 */

import { createHmac } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/** A grant of the API, as signing in answers it. */
type Grant = Readonly<{ accessToken: string }>;

export const Totp = {
  /** The six-digit code of a base32 secret, for the time step `offset` steps from now. */
  code: (secret: string, offset: number): string => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = [...secret.toUpperCase().replace(/[^A-Z2-7]/g, "")].map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0")).join("");
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
    const hash = createHmac("sha1", key).update(counter).digest();
    const start = (hash.at(-1) ?? 0) & 15;

    return String((hash.readUInt32BE(start) & 0x7fffffff) % 1_000_000).padStart(6, "0");
  },
} as const;

export const Stack = {
  /** The admin the e2e overlay makes at start. */
  ADMIN: {
    email: process.env["E2E_ADMIN_EMAIL"] ?? "admin@prism.test",
    password: process.env["E2E_ADMIN_PASSWORD"] ?? "e2e admin password",
    totpSecret: process.env["E2E_ADMIN_TOTP_SECRET"] ?? "EZEPRISMADMINTOTPSECRETFORTHESUITE",
  },
  /** The password of every customer the suite registers. */
  PASSWORD: "correct horse battery staple",
  /** A product the seed always plants. */
  PRODUCT_SLUG: "diamond-sword",

  /** Registers a new customer, which signs `request`'s browser context in as them. Resolves to the email. */
  registerCustomer: async (request: APIRequestContext, label: string): Promise<string> => {
    const email = `${label}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}@example.com`;
    const answer = await request.post("/api/v1/auth/register", { data: { email, password: Stack.PASSWORD, captchaToken: "e2e" } });
    expect(answer.status(), await answer.text()).toBe(201);
    return email;
  },

  /**
   * Signs the admin in through `request` with the current code, or with the
   * next one when the current one was already used: a code works once.
   * Resolves to the access token.
   */
  signInAdmin: async (request: APIRequestContext): Promise<string> => {
    const first = await request.post("/api/v1/auth/login", { data: { email: Stack.ADMIN.email, password: Stack.ADMIN.password } });
    const challenge = (await first.json()) as Readonly<{ status: string; challengeToken?: string }>;
    expect(challenge.status).toBe("two_factor_required");

    for (const offset of [0, 1]) {
      const answer = await request.post("/api/v1/auth/login/2fa", { data: { challengeToken: challenge.challengeToken, code: Totp.code(Stack.ADMIN.totpSecret, offset) } });
      if (answer.ok()) return ((await answer.json()) as Readonly<{ grant: Grant }>).grant.accessToken;
    }

    throw new Error("The admin's last two codes were used already. Start the e2e stack afresh, or run the suite again in a minute.");
  },

  /** Gives the account with `email` the staff `roles`, as the admin. */
  grantRoles: async (request: APIRequestContext, adminToken: string, email: string, roles: readonly string[]): Promise<void> => {
    const headers = { authorization: `Bearer ${adminToken}` };
    const found = (await (await request.get(`/api/v1/admin/users?email=${encodeURIComponent(email)}`, { headers })).json()) as Readonly<{ items: readonly Readonly<{ id: string }>[] }>;
    const account = found.items[0];
    if (account === undefined) throw new Error(`No account has ${email}.`);

    const answer = await request.put(`/api/v1/admin/users/${account.id}/roles`, { headers, data: { roles } });
    expect(answer.status(), await answer.text()).toBe(200);
  },

  /** Puts one of the seeded product in the cart of `request`'s browser context. */
  fillCart: async (request: APIRequestContext): Promise<void> => {
    const product = (await (await request.get(`/api/v1/products/${Stack.PRODUCT_SLUG}`)).json()) as Readonly<{ id: string }>;
    const answer = await request.post("/api/v1/cart/items", { data: { productId: product.id, quantity: 1 } });
    expect(answer.status(), await answer.text()).toBe(200);
  },
} as const;
