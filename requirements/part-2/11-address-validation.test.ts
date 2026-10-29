/**
 * REQUIREMENTS_2.md: "The system validates entered shipping address for
 * accuracy."
 *
 * Accuracy is a lookup in OpenStreetMap's geocoder. Through the API the
 * lookup is a stand-in a test steers; the shop's own geocoder client is
 * checked against a local server that answers as the geocoder does.
 */

import { createServer, type IncomingMessage, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import type { ShippingAddress } from "@prism/shared"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { AddressVerifier } from "../../apps/api/src/platform/address-verifier.ts"
import { CHECKOUT, Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 }])
})

const NOT_FOUND = "We could not find this address. Check the street, postal code and city."

const check = (address: object) => Shop.call(harness, "POST", "/checkout/address", {}, address)

describe("the address check checkout makes as the customer types", () => {
  it("answers whether the lookup found the address, and asks it what was typed", async () => {
    expect(jsonOf(await check(CHECKOUT.address))).toEqual({ status: "verified" })

    harness.addressVerifier.answer("not_found")
    expect(jsonOf(await check({ ...CHECKOUT.address, line1: "Nowhere street 999" }))).toEqual({ status: "not_found" })

    expect(harness.addressVerifier.asked).toEqual([CHECKOUT.address, { ...CHECKOUT.address, line1: "Nowhere street 999" }])
  })

  it("refuses a postal code in the wrong format for the country before asking anyone", async () => {
    const response = await check({ ...CHECKOUT.address, postalCode: "1011" })

    expect(response.statusCode).toBe(422)
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "postalCode", message: "Enter a postal code like 10111." }] })
    expect(harness.addressVerifier.asked).toEqual([])
  })
})

describe("placing an order", () => {
  it("is refused for an address the lookup cannot find, on the street field, and reserves nothing", async () => {
    harness.addressVerifier.answer("not_found")
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])
    const response = await Shop.place(harness, guest)

    expect(response.statusCode).toBe(422)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ValidationFailed", issues: [{ path: "address.line1", message: NOT_FOUND }] })
    expect(await Shop.stockOf(harness, "desk-lamp")).toBe(10)
    expect(harness.gateway.calls.createIntent).toEqual([])
  })

  it("goes through for an address the lookup found", async () => {
    const guest = await Shop.fill(harness, [["desk-lamp", 1]])

    expect((await Shop.place(harness, guest)).statusCode).toBe(201)
    expect(harness.addressVerifier.asked).toEqual([CHECKOUT.address])
  })
})

describe("the geocoder client", () => {
  let geocoder: Server
  let baseUrl: string
  let answer: { status: number; body: unknown } = { status: 200, body: [] }
  const queries: URLSearchParams[] = []

  beforeAll(async () => {
    geocoder = createServer((request: IncomingMessage, response) => {
      queries.push(new URL(request.url ?? "/", "http://geocoder").searchParams)
      response.writeHead(answer.status, { "content-type": "application/json" }).end(JSON.stringify(answer.body))
    })
    await new Promise<void>((resolve) => geocoder.listen(0, "127.0.0.1", resolve))
    baseUrl = `http://127.0.0.1:${(geocoder.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await new Promise((resolve) => geocoder.close(resolve))
  })

  const address: ShippingAddress = { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" }

  it("searches by street, city, postal code and country together", async () => {
    answer = { status: 200, body: [{ place_id: 1, lat: "59.43", lon: "24.76" }] }

    expect(await AddressVerifier.nominatim(baseUrl, "Prism test").verify(address)).toBe("verified")
    expect(Object.fromEntries(queries.at(-1) ?? [])).toMatchObject({
      street: "Narva mnt 7",
      city: "Tallinn",
      postalcode: "10117",
      countrycodes: "ee",
    })
  })

  it("calls an address with no match not found, and a geocoder that fails unavailable", async () => {
    answer = { status: 200, body: [] }
    expect(await AddressVerifier.nominatim(baseUrl, "Prism test").verify(address)).toBe("not_found")

    answer = { status: 503, body: { error: "busy" } }
    expect(await AddressVerifier.nominatim(baseUrl, "Prism test").verify(address)).toBe("unavailable")
  })
})
