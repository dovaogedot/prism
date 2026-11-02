/**
 * REQUIREMENTS_3.md: "All sensitive data stored in database is encrypted at
 * rest.
 *
 *   Check encryption implementation for: user credentials, personally
 *   identifiable information, shipping addresses, order details and session
 *   tokens"
 *
 * A customer types every kind of value the note lists, then every row of
 * every table is read raw and searched for each one. The order details are
 * those that tell who ordered and where it goes: the contact and the
 * addresses. Its lines name catalog products, which identify nobody.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, seedCatalog, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Hasher } from "../../apps/api/src/platform/hasher.ts"

let harness: Harness
let stored: string
let typed: Readonly<Record<string, string>>
let accessToken: string
let orderId: string

beforeAll(async () => {
  harness = await startHarness({ hasher: Hasher.argon2() })
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 }])

  const registered = await registerUser(harness, "mari.maasikas@example.com")
  accessToken = registered.accessToken
  const caller = { token: accessToken }
  await Shop.call(harness, "PUT", "/account/profile", caller, { fullName: "Mari Maasikas", phone: "+372 5123 4567" })
  await Shop.call(harness, "POST", "/account/addresses", caller, {
    label: "Home",
    fullName: "Mari Maasikas",
    phone: "+372 5123 4567",
    address: { line1: "Lossi plats 1a", city: "Tartu", postalCode: "51003", country: "EE" },
  })

  // A guest's order too, whose cart and order are reached by tokens of their own.
  const guest = await Shop.fill(harness, [["desk-lamp", 1]])
  const placed = await Shop.place(harness, guest, {
    contact: { fullName: "Jaan Tamm", email: "jaan.tamm@example.com", phone: "+372 5555 0101" },
    address: { line1: "Rataskaevu 16", city: "Tallinn", postalCode: "10123", country: "EE" },
    billingAddress: { line1: "Pikk jalg 9", city: "Tallinn", postalCode: "10130", country: "EE" },
  })
  orderId = String(jsonOf(placed)["orderId"])

  typed = {
    password: VALID_PASSWORD,
    "account email": "mari.maasikas@example.com",
    "full name": "Maasikas",
    phone: "51234567",
    "saved address": "Lossi plats",
    "saved city": "Tartu",
    "order email": "jaan.tamm@example.com",
    "order name": "Jaan Tamm",
    "order phone": "55550101",
    "shipping address": "Rataskaevu",
    "billing address": "Pikk jalg",
    "refresh token": registered.refreshToken,
    "guest cart token": guest.guest ?? "",
    "guest order key": String(jsonOf(placed)["key"]),
  }

  const tables = await harness.database.sql<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
  const rows: string[] = []

  for (const { tablename } of tables) {
    const dumped = await harness.database.sql.unsafe(`SELECT row_to_json(t)::text AS row FROM "${tablename}" t`)
    rows.push(...dumped.map((row) => `${tablename}: ${String(row["row"])}`))
  }

  stored = rows.join("\n")
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

describe("the database, read raw", () => {
  it("holds rows for everything the customer and the guest gave, and shows plain columns as text", async () => {
    expect(Object.values(typed).filter((value) => value.length === 0 || value === "undefined")).toEqual([])
    // The order line's product name is plain, so a value stored as text would be found the same way.
    expect(stored).toContain('"product_name":"Desk Lamp"')
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM address`).toEqual([{ n: 1 }])
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM customer_order`).toEqual([{ n: 1 }])
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM refresh_token`).toEqual([{ n: 1 }])
  })

  it.each(["password", "account email", "full name", "phone", "saved address", "saved city"])(
    "holds no %s of the account in plain text",
    (name) => {
      expect(stored).not.toContain(typed[name])
    },
  )

  it.each(["order email", "order name", "order phone", "shipping address", "billing address"])("holds no %s in plain text", (name) => {
    expect(stored).not.toContain(typed[name])
  })

  it.each(["refresh token", "guest cart token", "guest order key"])("holds no %s in plain text", (name) => {
    expect(stored).not.toContain(typed[name])
  })

  it("keeps the password as an argon2id hash", async () => {
    const [user] = await harness.database.sql`SELECT password_hash FROM app_user`

    expect(String(user?.["password_hash"])).toMatch(/^\$argon2id\$/)
  })
})

describe("the API", () => {
  it("serves the sealed values opened, to the people they belong to", async () => {
    const caller = { token: accessToken }
    const profile = jsonOf(await Shop.call(harness, "GET", "/account/profile", caller))
    const addresses = jsonOf(await Shop.call(harness, "GET", "/account/addresses", caller))["items"]
    const order = jsonOf(await Shop.call(harness, "GET", `/orders/${orderId}?key=${typed["guest order key"] ?? ""}`))

    expect(profile).toEqual({ email: "mari.maasikas@example.com", fullName: "Mari Maasikas", phone: "+372 51234567" })
    expect(addresses).toEqual([expect.objectContaining({ address: expect.objectContaining({ line1: "Lossi plats 1a", city: "Tartu" }) })])
    expect(order).toMatchObject({
      contact: { fullName: "Jaan Tamm", email: "jaan.tamm@example.com" },
      address: { line1: "Rataskaevu 16" },
      billingAddress: { line1: "Pikk jalg 9" },
    })
  })

  it("signs the customer in with the password the database holds only as a hash", async () => {
    const response = await harness.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "mari.maasikas@example.com", password: VALID_PASSWORD },
    })

    expect(jsonOf(response)).toMatchObject({ status: "authenticated" })
  })
})
