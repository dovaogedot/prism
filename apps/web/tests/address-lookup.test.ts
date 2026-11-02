import { AddressCheck, ShippingAddress } from "@prism/shared"
import { QueryClient } from "@tanstack/react-query"
import { describe, expect, it } from "vitest"
import { AddressLookups } from "../src/features/checkout/address-lookup.ts"

/** An address as a customer types it, and the key the line under the address reads its verdict from. */
const typed = { line1: " Narva mnt 7 ", line2: "", city: "Tallinn", postalCode: "10117", country: "EE" }
const lookupKey = AddressLookups.keyOf(JSON.stringify(ShippingAddress.schema.parse(typed)))

describe("AddressLookups.takeNotFound", () => {
  it("records a refused save's not found as the verdict on that address, and leaves no such issue for a field", () => {
    const client = new QueryClient()
    const phone = { path: "phone", message: "Start with the country code, such as +372 for Estonia." }

    const left = AddressLookups.takeNotFound(client, ShippingAddress.schema.parse(typed), [
      { path: "address.line1", message: AddressCheck.NOT_FOUND },
      phone,
    ])

    expect(left).toEqual([phone])
    expect(client.getQueryData(lookupKey)).toEqual({ status: "not_found" })
  })

  it("records nothing when the server found no fault with the address", () => {
    const client = new QueryClient()
    const street = { path: "address.line1", message: "Enter the street name as well as the house number." }

    expect(AddressLookups.takeNotFound(client, ShippingAddress.schema.parse(typed), [street])).toEqual([street])
    expect(client.getQueryData(lookupKey)).toBeUndefined()
  })
})
