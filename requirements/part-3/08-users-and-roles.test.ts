/**
 * REQUIREMENTS_3.md: "Admins can view all users and assign roles."
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { jsonOf, registerUser, startHarness, userIdOf, type Harness } from "../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../apps/api/tests/support/staff.ts"

let harness: Harness
let admin: TestAccount

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  admin = await Staff.account(harness, "admin@example.com", ["admin"])
})

type Listed = { items: { id: string; email: string; roles: string[] }[]; total: number }

const list = async (query = ""): Promise<Listed> =>
  jsonOf(await Staff.call(harness, admin, "GET", `/admin/users${query}`)) as unknown as Listed

describe("the admin's account list", () => {
  it("shows every account, page by page", async () => {
    const emails = Array.from({ length: 5 }, (_, index) => `customer-${index}@example.com`)

    for (const email of emails) {
      await registerUser(harness, email)
    }

    const first = await list("?perPage=4&page=1")
    const second = await list("?perPage=4&page=2")

    expect(first.total).toBe(6)
    expect([...first.items, ...second.items].map((item) => item.email).toSorted()).toEqual(["admin@example.com", ...emails].toSorted())
  })

  it("opens one account with its roles", async () => {
    await registerUser(harness, "mari@example.com")
    const id = await userIdOf(harness, "mari@example.com")

    expect(jsonOf(await Staff.call(harness, admin, "GET", `/admin/users/${id}`))).toMatchObject({ email: "mari@example.com", roles: [] })
  })
})

describe("assigning roles", () => {
  it("gives an account staff roles and takes them back, and the account's own session sees the change", async () => {
    const { accessToken } = await registerUser(harness, "mari@example.com")
    const id = await userIdOf(harness, "mari@example.com")
    const rolesSeen = async () => jsonOf(await Staff.call(harness, { ...admin, accessToken }, "GET", "/auth/me"))["roles"]

    const given = await Staff.call(harness, admin, "PUT", `/admin/users/${id}/roles`, { roles: ["support", "moderator"] })

    expect(given.statusCode).toBe(200)
    expect((await rolesSeen()) as string[]).toEqual(expect.arrayContaining(["support", "moderator"]))
    expect((await list("?role=support")).items.map((item) => item.email)).toEqual(["mari@example.com"])

    await Staff.call(harness, admin, "PUT", `/admin/users/${id}/roles`, { roles: [] })

    expect(await rolesSeen()).toEqual([])
    expect((await list("?staff=true")).items.map((item) => item.email)).toEqual(["admin@example.com"])
  })

  it("is for admins only: support can view accounts but not change roles", async () => {
    const support = await Staff.account(harness, "support@example.com", ["support"])
    const id = await userIdOf(harness, "admin@example.com")

    expect((await Staff.call(harness, support, "GET", "/admin/users")).statusCode).toBe(200)
    expect((await Staff.call(harness, support, "PUT", `/admin/users/${id}/roles`, { roles: [] })).statusCode).toBe(403)
  })
})
