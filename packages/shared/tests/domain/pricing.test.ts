import { describe, expect, it } from "vitest";
import { ShippingMethod } from "../../src/contracts/checkout.ts";
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

describe("Pricing.shipping", () => {
  it("charges standard shipping under the free-from threshold", () => {
    expect(Pricing.shipping("standard", 4999)).toBe(ShippingMethod.priceCents.standard);
  });

  it("ships standard free from the threshold itself", () => {
    expect(Pricing.shipping("standard", 5000)).toBe(0);
    expect(Pricing.shipping("standard", 12_000)).toBe(0);
  });

  it("always charges express", () => {
    expect(Pricing.shipping("express", 100)).toBe(ShippingMethod.priceCents.express);
    expect(Pricing.shipping("express", 100_000)).toBe(ShippingMethod.priceCents.express);
  });
});

describe("Pricing.totals", () => {
  it("adds shipping to the subtotal", () => {
    expect(Pricing.totals([{ unitPriceCents: 1500, quantity: 2 }], "standard")).toEqual({
      subtotalCents: 3000,
      shippingCents: 490,
      totalCents: 3490,
    });
  });

  it("drops standard shipping once the subtotal reaches the threshold", () => {
    expect(Pricing.totals([{ unitPriceCents: 2500, quantity: 2 }], "standard")).toEqual({
      subtotalCents: 5000,
      shippingCents: 0,
      totalCents: 5000,
    });
  });

  it("keeps express shipping above the threshold", () => {
    expect(Pricing.totals([{ unitPriceCents: 2500, quantity: 2 }], "express")).toEqual({
      subtotalCents: 5000,
      shippingCents: 990,
      totalCents: 5990,
    });
  });
});
