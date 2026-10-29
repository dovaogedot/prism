/**
 * REQUIREMENTS_2.md: "The database schema includes tables and relationships
 * to support the shopping cart functionality, including guest carts and
 * persistent carts for logged-in users."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { registerUser, seedCatalog, startHarness, userIdOf, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 5 }])
})

describe("the tables", () => {
  it("hold carts and their items, each item pointing at its cart and its product, and a cart at its account", async () => {
    const foreignKeys = await harness.database.sql`
      SELECT c.conrelid::regclass::text AS "table", a.attname AS "column", c.confrelid::regclass::text AS "references"
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.conrelid::regclass::text IN ('cart', 'cart_item')
      ORDER BY 1, 2`

    expect(foreignKeys).toEqual([
      { table: "cart", column: "user_id", references: "app_user" },
      { table: "cart_item", column: "cart_id", references: "cart" },
      { table: "cart_item", column: "product_id", references: "product" },
    ])
  })

  it("give an account one cart at most, and a guest cart its token and expiry", async () => {
    const unique = await harness.database.sql`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'cart' AND indexdef LIKE 'CREATE UNIQUE INDEX%'`
    const columns = await harness.database.sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'cart' ORDER BY column_name`

    expect(unique.map((row) => String(row["indexdef"]))).toEqual(
      expect.arrayContaining([expect.stringContaining("(user_id)"), expect.stringContaining("(token_hash)")]),
    )
    expect(columns.map((row) => row["column_name"])).toEqual(expect.arrayContaining(["user_id", "token_hash", "expires_at"]))
  })
})

describe("the rows", () => {
  it("keep a guest's cart under its token, with an expiry and no account", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 2]])

    const [cart] = await harness.database.sql`SELECT id, user_id, token_hash, expires_at FROM cart`
    const items = await harness.database.sql`SELECT cart_id, quantity FROM cart_item`

    expect(cart).toMatchObject({ user_id: null, token_hash: expect.stringMatching(/^[0-9a-f]{64}$/), expires_at: expect.any(String) })
    expect(items).toEqual([{ cart_id: cart?.["id"], quantity: 2 }])
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", guest)).body)).toMatchObject({ itemCount: 2 })
  })

  it("keep a member's cart under the account, with no token and no expiry", async () => {
    const { accessToken } = await registerUser(harness, "member@example.com")
    await Shop.fill(harness, [["desk-lamp", 3]], { token: accessToken })

    const [cart] = await harness.database.sql`SELECT id, user_id, token_hash, expires_at FROM cart`
    const items = await harness.database.sql`SELECT cart_id, quantity FROM cart_item`

    expect(cart).toMatchObject({ user_id: await userIdOf(harness, "member@example.com"), token_hash: null, expires_at: null })
    expect(items).toEqual([{ cart_id: cart?.["id"], quantity: 3 }])
    expect(JSON.parse((await Shop.call(harness, "GET", "/cart", { token: accessToken })).body)).toMatchObject({ itemCount: 3 })
  })
})
