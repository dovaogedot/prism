import { describe, expect, it } from "vitest"
import { AddToCartInput } from "../../src/contracts/cart.ts"
import { Contact, Country, DeclineCodes, PhoneNumber, PlaceOrderInput, ShippingAddress } from "../../src/contracts/checkout.ts"

/** The messages a failed parse reports, keyed by the dotted path of each field. */
const issuesOf = (result: { success: boolean; error?: { issues: readonly { path: PropertyKey[]; message: string }[] } }) =>
  Object.fromEntries((result.error?.issues ?? []).map((issue) => [issue.path.join("."), issue.message]))

const address = { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" }
const contact = { fullName: "Mari Maasikas", email: "mari@example.com", phone: "+372 5123 4567" }

describe("Contact", () => {
  it("accepts a valid contact and normalizes the phone and email", () => {
    expect(Contact.schema.parse({ ...contact, email: " Mari@Example.COM " })).toEqual({
      fullName: "Mari Maasikas",
      email: "mari@example.com",
      phone: "+372 51234567",
    })
  })

  it("accepts the separators people type in a phone number, and keeps one space after the country code", () => {
    expect(Contact.schema.parse({ ...contact, phone: "+49 (30) 123-456.78" }).phone).toBe("+49 3012345678")
  })

  it("accepts a number of any country", () => {
    expect(Contact.schema.parse({ ...contact, phone: "+1 212 456 7890" }).phone).toBe("+1 2124567890")
    expect(Contact.schema.parse({ ...contact, phone: "+7 912 345 6789" }).phone).toBe("+7 9123456789")
  })

  it("names every missing field with its own sentence", () => {
    expect(issuesOf(Contact.schema.safeParse({ fullName: "", email: "", phone: "" }))).toEqual({
      fullName: "Enter your full name.",
      email: "Enter a valid email address.",
      phone: "Enter a phone number.",
    })
  })

  it("asks for the country code, a code some country uses, and digits that make a number there", () => {
    const problemOf = (phone: string) => issuesOf(Contact.schema.safeParse({ ...contact, phone }))["phone"]

    expect(problemOf("5123 4567")).toBe("Start with the country code, such as +372 for Estonia.")
    expect(problemOf("12ab")).toBe("Start with the country code, such as +372 for Estonia.")
    expect(problemOf("+999 1234567")).toBe("Check the country code after the +: no country uses it.")
    expect(problemOf("+372 123")).toBe("This is not a phone number in Estonia. Check the digits after +372.")
    // A number too short to parse still names the country its flag shows.
    expect(problemOf("+372 5")).toBe("This is not a phone number in Estonia. Check the digits after +372.")
    expect(problemOf("+1 212")).toBe("Check the digits after +1: they make no phone number there.")
    expect(problemOf("+1234567890123456")).toBeDefined()
  })

  it("refuses a malformed email", () => {
    expect(issuesOf(Contact.schema.safeParse({ ...contact, email: "mari@" }))).toEqual({ email: "Enter a valid email address." })
  })
})

describe("PhoneNumber", () => {
  it("names the country of a number as it is typed, once its digits say", () => {
    expect(PhoneNumber.findCountry("+3")).toBeUndefined()
    expect(PhoneNumber.findCountry("+3725")).toBe("EE")
    // The countries that share +1 tell apart only by a whole number.
    expect(PhoneNumber.findCountry("+1 212 456")).toBeUndefined()
    expect(PhoneNumber.findCountry("+1 212 456 7890")).toBe("US")
  })

  it("puts one space after a whole country code, and leaves a number that has one, or no whole code yet, as it is", () => {
    expect(PhoneNumber.spaceAfterCode("+3725")).toBe("+372 5")
    expect(PhoneNumber.spaceAfterCode("+3725123")).toBe("+372 5123")
    expect(PhoneNumber.spaceAfterCode("+372 5123")).toBe("+372 5123")
    expect(PhoneNumber.spaceAfterCode("+372")).toBe("+372")
    expect(PhoneNumber.spaceAfterCode("+37")).toBe("+37")
    expect(PhoneNumber.spaceAfterCode("5123")).toBe("5123")
  })
})

describe("ShippingAddress", () => {
  it("accepts a valid address and treats a blank second line as absent", () => {
    expect(ShippingAddress.schema.parse({ ...address, line2: "  " })).toEqual(address)
  })

  it("names every missing field with its own sentence", () => {
    expect(issuesOf(ShippingAddress.schema.safeParse({ line1: "", city: "", postalCode: "", country: "" }))).toEqual({
      line1: "Enter the street and house number.",
      city: "Enter the city.",
      postalCode: "Enter the postal code.",
      country: "Choose a country.",
    })
  })

  it("refuses a street that is only a number and a city that is one letter, as in 233, f", () => {
    expect(issuesOf(ShippingAddress.schema.safeParse({ ...address, line1: "233", city: "f" }))).toEqual({
      line1: "Enter the street name as well as the house number.",
      city: "Enter the city's full name.",
    })
    expect(issuesOf(ShippingAddress.schema.safeParse({ ...address, city: "12" }))).toEqual({ city: "Enter the city's full name." })
    expect(ShippingAddress.schema.safeParse({ ...address, line1: "Tamme talu", city: "Ii" }).success).toBe(true)
  })

  it("checks the postal code against the country, with an example in the message", () => {
    expect(issuesOf(ShippingAddress.schema.safeParse({ ...address, postalCode: "1011" }))).toEqual({
      postalCode: "Enter a postal code like 10111.",
    })
    expect(issuesOf(ShippingAddress.schema.safeParse({ ...address, country: "NL", postalCode: "10117" }))).toEqual({
      postalCode: "Enter a postal code like 1012 AB.",
    })
  })

  it("accepts every country's example postal code", () => {
    for (const country of Country.CODES) {
      const parsed = ShippingAddress.schema.safeParse({ ...address, country, postalCode: Country.postalCodeExample[country] })
      expect(parsed.success, country).toBe(true)
    }
  })

  it("uppercases a postal code before checking it", () => {
    expect(ShippingAddress.schema.parse({ ...address, country: "NL", postalCode: "1012 ab" }).postalCode).toBe("1012 AB")
  })
})

describe("PlaceOrderInput", () => {
  const order = { contact, address, shippingMethod: "standard", expectedTotalCents: 3490 }

  it("accepts a complete order", () => {
    expect(PlaceOrderInput.schema.safeParse(order).success).toBe(true)
  })

  it("refuses unknown keys, so no price or card field can ride along", () => {
    expect(PlaceOrderInput.schema.safeParse({ ...order, totalCents: 1 }).success).toBe(false)
    expect(PlaceOrderInput.schema.safeParse({ ...order, cardNumber: "4242424242424242" }).success).toBe(false)
  })

  it("refuses a missing shipping method, and a code of the wrong shape", () => {
    expect(issuesOf(PlaceOrderInput.schema.safeParse({ contact, address, expectedTotalCents: 3490 }))).toEqual({
      shippingMethod: "Choose a shipping method.",
    })
    expect(issuesOf(PlaceOrderInput.schema.safeParse({ ...order, shippingMethod: "Drone Delivery" }))).toEqual({
      shippingMethod: "Use lowercase letters, digits and single dashes.",
    })
  })
})

describe("AddToCartInput", () => {
  const productId = "6f1c2a52-3b8e-4f43-9a6e-1c2d3e4f5a6b"

  it("defaults the quantity to one", () => {
    expect(AddToCartInput.schema.parse({ productId }).quantity).toBe(1)
  })

  it("refuses a quantity outside 1 to 99, or not a whole number", () => {
    expect(AddToCartInput.schema.safeParse({ productId, quantity: 0 }).success).toBe(false)
    expect(AddToCartInput.schema.safeParse({ productId, quantity: 100 }).success).toBe(false)
    expect(AddToCartInput.schema.safeParse({ productId, quantity: 1.5 }).success).toBe(false)
  })

  it("refuses a price in the body", () => {
    expect(AddToCartInput.schema.safeParse({ productId, quantity: 1, priceCents: 1 }).success).toBe(false)
  })
})

describe("DeclineCodes.failureOf", () => {
  it("prefers the decline code, which says why the bank refused", () => {
    expect(DeclineCodes.failureOf("insufficient_funds", "card_declined")).toBe("insufficient_funds")
  })

  it("falls back to the error code for card errors without a known decline code", () => {
    expect(DeclineCodes.failureOf(undefined, "expired_card")).toBe("expired_card")
    expect(DeclineCodes.failureOf(undefined, "incorrect_cvc")).toBe("incorrect_cvc")
    expect(DeclineCodes.failureOf("generic_decline", "card_declined")).toBe("card_declined")
  })

  it("names a failed 3D Secure check", () => {
    expect(DeclineCodes.failureOf(undefined, "payment_intent_authentication_failure")).toBe("authentication_failed")
  })

  it("calls an unknown code a decline, and no code at all a processing error", () => {
    expect(DeclineCodes.failureOf(undefined, "something_new")).toBe("card_declined")
    expect(DeclineCodes.failureOf(undefined, undefined)).toBe("processing_error")
  })
})
