import { describe, expect, it } from "vitest";
import { Pricing } from "../../src/domain/pricing.ts";

describe("Pricing.lineTotal", () => {
  it("multiplies the unit price by the quantity", () => {
    expect(Pricing.lineTotal({ unitPriceCents: 1999, quantity: 3 })).toBe(5997);
  });
});

describe("Pricing.subtotal", () => {
  it("sums the line totals", () => {
    expect(
      Pricing.subtotal([
        { unitPriceCents: 1999, quantity: 3 },
        { unitPriceCents: 450, quantity: 2 },
      ]),
    ).toBe(6897);
  });

  it("is zero for no lines", () => {
    expect(Pricing.subtotal([])).toBe(0);
  });

  it("stays exact where floating-point euros would drift", () => {
    // 0.10 + 0.20 is 0.30000000000000004 in euros, and exactly 30 in cents.
    expect(
      Pricing.subtotal([
        { unitPriceCents: 10, quantity: 1 },
        { unitPriceCents: 20, quantity: 1 },
      ]),
    ).toBe(30);
  });
});

/** Options shaped like the two the shop starts with, and one that is always free. */
const standard = { priceCents: 490, freeFromCents: 5000 };
const express = { priceCents: 990 };
const pickup = { priceCents: 0 };

describe("Pricing.shipping", () => {
  it("charges the price below the free-from threshold", () => {
    expect(Pricing.shipping(standard, 4999)).toBe(490);
  });

  it("ships free at the threshold itself and above it", () => {
    expect(Pricing.shipping(standard, 5000)).toBe(0);
    expect(Pricing.shipping(standard, 12_000)).toBe(0);
  });

  it("always charges an option without a threshold", () => {
    expect(Pricing.shipping(express, 100)).toBe(990);
    expect(Pricing.shipping(express, 100_000)).toBe(990);
  });

  it("charges nothing for a free option", () => {
    expect(Pricing.shipping(pickup, 100)).toBe(0);
  });
});

describe("Pricing.untilFree", () => {
  it("says how far a subtotal is from free shipping, and never below zero", () => {
    expect(Pricing.untilFree(standard, 4000)).toBe(1000);
    expect(Pricing.untilFree(standard, 6000)).toBe(0);
    expect(Pricing.untilFree(express, 4000)).toBeUndefined();
  });
});

describe("Pricing.totals", () => {
  it("adds shipping to the subtotal", () => {
    expect(Pricing.totals([{ unitPriceCents: 1500, quantity: 2 }], standard)).toEqual({
      subtotalCents: 3000,
      shippingCents: 490,
      totalCents: 3490,
    });
  });

  it("drops shipping once the subtotal reaches the threshold", () => {
    expect(Pricing.totals([{ unitPriceCents: 2500, quantity: 2 }], standard)).toEqual({
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
    });
  });

  it("keeps the price of an option without a threshold", () => {
    expect(Pricing.totals([{ unitPriceCents: 2500, quantity: 2 }], express)).toEqual({
      subtotalCents: 5000,
      shippingCents: 990,
      totalCents: 5990,
    });
  });
});
