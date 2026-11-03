import { describe, expect, it } from "vitest"
import { AdminProductQuery, ShippingMethodInput } from "../../src/contracts/admin.ts"

describe("AdminProductQuery", () => {
  it("reads a sort named by its field alone as that field's first order", () => {
    const sortOf = (sort?: string) => AdminProductQuery.schema.parse(sort === undefined ? {} : { sort }).sort

    expect([sortOf("name"), sortOf("stock"), sortOf("price"), sortOf("price_desc"), sortOf()]).toEqual([
      "name_asc",
      "stock_asc",
      "price_asc",
      "price_desc",
      "name_asc",
    ])
    expect(AdminProductQuery.schema.safeParse({ sort: "rating" }).success).toBe(false)
  })
})

describe("ShippingMethodInput", () => {
  const option = { code: "pickup", name: "Pickup", priceCents: 0, minDays: 1, maxDays: 2, isActive: true, position: 0 }
  const codeIssueOf = (code: unknown) => ShippingMethodInput.schema.safeParse({ ...option, code }).error?.issues[0]?.message

  it("asks staff to enter a code they left out or empty", () => {
    expect([codeIssueOf(undefined), codeIssueOf(""), codeIssueOf("  ")]).toEqual(["Enter a code.", "Enter a code.", "Enter a code."])
  })

  it("holds a typed code to the format checkout chooses by", () => {
    expect(codeIssueOf("Drone Delivery")).toBe("Use lowercase letters, digits and single dashes.")
    expect(codeIssueOf("x".repeat(41))).toBe("Use at most 40 characters.")
    expect(ShippingMethodInput.schema.parse(option).code).toBe("pickup")
  })
})
