import { ProductId, Slug, type CartView } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { CartCache } from "../src/features/cart/cart.ts";

const lamp = ProductId.schema.parse("6f1c2a52-3b8e-4f43-9a6e-1c2d3e4f5a6b");
const chair = ProductId.schema.parse("7a2d3b63-4c9f-4054-8b7f-2d3e4f5a6b7c");

const view: CartView = {
  lines: [
    { productId: lamp, slug: Slug.schema.parse("lamp"), name: "Lamp", unitPriceCents: 2500, quantity: 2, stock: 5, lineTotalCents: 5000 },
    { productId: chair, slug: Slug.schema.parse("chair"), name: "Chair", unitPriceCents: 12_000, quantity: 1, stock: 2, lineTotalCents: 12_000 },
  ],
  itemCount: 3,
  subtotalCents: 17_000,
};

describe("CartCache.withQuantity", () => {
  it("changes one line and recomputes its total, the count and the subtotal", () => {
    const next = CartCache.withQuantity(view, lamp, 4);

    expect(next.lines[0]).toMatchObject({ quantity: 4, lineTotalCents: 10_000 });
    expect(next.lines[1]).toBe(view.lines[1]);
    expect(next).toMatchObject({ itemCount: 5, subtotalCents: 22_000 });
  });

  it("leaves the view as it was for a product it does not hold", () => {
    const stranger = ProductId.schema.parse("8b3e4c74-5da0-4165-9c80-3e4f5a6b7c8d");
    expect(CartCache.withQuantity(view, stranger, 9)).toEqual(view);
  });

  it("does not change the view it was given", () => {
    CartCache.withQuantity(view, lamp, 4);
    expect(view.lines[0]?.quantity).toBe(2);
  });
});

describe("CartCache.without", () => {
  it("drops the line and recomputes the count and subtotal", () => {
    expect(CartCache.without(view, chair)).toEqual({ lines: [view.lines[0]], itemCount: 2, subtotalCents: 5000 });
  });

  it("empties the totals with the last line", () => {
    expect(CartCache.without(CartCache.without(view, chair), lamp)).toEqual({ lines: [], itemCount: 0, subtotalCents: 0 });
  });
});

describe("CartCache.key", () => {
  it("keeps a guest's cart apart from each signed-in user's", () => {
    expect(CartCache.key(undefined)).toEqual(["cart", "guest"]);
    expect(CartCache.recommendationsKey(undefined)).toEqual(["cart", "guest", "recommendations"]);
  });
});
