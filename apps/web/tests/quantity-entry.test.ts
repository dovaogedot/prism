import { describe, expect, it } from "vitest"
import { QuantityEntry } from "../src/features/cart/quantity-entry.ts"

describe("QuantityEntry.read", () => {
  it("takes a whole number from 1 to the stock as typed, with nothing to say", () => {
    expect(QuantityEntry.read("1", 2, 5)).toEqual({ quantity: 1 })
    expect(QuantityEntry.read("5", 2, 5)).toEqual({ quantity: 5 })
  })

  it("brings a number past the stock down to the stock, and says how many are left", () => {
    expect(QuantityEntry.read("5", 1, 1)).toEqual({ quantity: 1, note: "Only 1 left." })
    expect(QuantityEntry.read("500", 1, 4)).toEqual({ quantity: 4, note: "Only 4 left." })
  })

  it("brings a number past the line limit down to it, and names the limit, when the stock is larger", () => {
    expect(QuantityEntry.read("150", 1, 500)).toEqual({ quantity: 99, note: "You can order at most 99 of one item." })
  })

  it("lets a line the stock fell under keep its quantity, and names the stock when more is typed", () => {
    expect(QuantityEntry.read("4", 6, 3)).toEqual({ quantity: 4 })
    expect(QuantityEntry.read("8", 6, 3)).toEqual({ quantity: 6, note: "Only 3 left." })
  })

  it("brings a number below 1 up to 1, and says so", () => {
    expect(QuantityEntry.read("0", 3, 5)).toEqual({ quantity: 1, note: "Enter at least 1." })
    expect(QuantityEntry.read("-2", 3, 5)).toEqual({ quantity: 1, note: "Enter at least 1." })
  })

  it("keeps the quantity for text that is not a whole number, and says so, and for an empty field without a word", () => {
    expect(QuantityEntry.read("2.5", 3, 5)).toEqual({ quantity: 3, note: "Enter a whole number." })
    expect(QuantityEntry.read("  ", 3, 5)).toEqual({ quantity: 3 })
  })
})

describe("QuantityEntry.findCeiling", () => {
  it("is the stock, the quantity held when that is more, and never past the line limit or below 1", () => {
    expect(QuantityEntry.findCeiling(1, 4)).toBe(4)
    expect(QuantityEntry.findCeiling(6, 3)).toBe(6)
    expect(QuantityEntry.findCeiling(1, 500)).toBe(99)
    expect(QuantityEntry.findCeiling(1, 0)).toBe(1)
  })
})
