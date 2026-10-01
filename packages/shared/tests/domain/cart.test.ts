import { describe, expect, it } from "vitest";
import { Quantity } from "../../src/contracts/cart.ts";
import { ProductId } from "../../src/contracts/catalog.ts";
import { Cart } from "../../src/domain/cart.ts";

const lamp = ProductId.schema.parse("6f1c2a52-3b8e-4f43-9a6e-1c2d3e4f5a6b");
const chair = ProductId.schema.parse("7a2d3b63-4c9f-4054-8b7f-2d3e4f5a6b7c");

describe("Cart.add", () => {
  it("adds to what the line already holds", () => {
    expect(Cart.add(2, 3, 10)).toEqual({ _tag: "Allowed", quantity: 5 });
  });

  it("allows exactly the stock", () => {
    expect(Cart.add(4, 1, 5)).toEqual({ _tag: "Allowed", quantity: 5 });
  });

  it("names the limit when the sum passes the stock", () => {
    expect(Cart.add(4, 2, 5)).toEqual({ _tag: "Short", message: "Only 5 left." });
  });

  it("calls a product with no stock sold out", () => {
    expect(Cart.add(0, 1, 0)).toEqual({ _tag: "Short", message: "Sold out." });
  });

  it("refuses more than the line limit even with stock to spare", () => {
    expect(Cart.add(98, 2, 500)).toEqual({ _tag: "Short", message: "You can order at most 99 of one item." });
    expect(Cart.add(98, 1, 500)).toEqual({ _tag: "Allowed", quantity: Quantity.MAX });
  });
});

describe("Cart.set", () => {
  it("replaces the quantity rather than adding to it", () => {
    expect(Cart.set(3, 10)).toEqual({ _tag: "Allowed", quantity: 3 });
  });

  it("refuses a quantity above the stock", () => {
    expect(Cart.set(3, 2)).toEqual({ _tag: "Short", message: "Only 2 left." });
  });
});

describe("Cart.merge", () => {
  it("sums the guest and user quantities", () => {
    expect(Cart.merge(2, 3, 10)).toBe(5);
  });

  it("caps the sum at the stock", () => {
    expect(Cart.merge(4, 4, 6)).toBe(6);
  });

  it("caps the sum at the line limit", () => {
    expect(Cart.merge(60, 60, 1000)).toBe(Quantity.MAX);
  });

  it("keeps a sold-out line at one, so the cart can say it is sold out", () => {
    expect(Cart.merge(2, 0, 0)).toBe(1);
  });
});

describe("Cart.issues", () => {
  it("lists only the lines the shop cannot supply, keyed by product", () => {
    expect(
      Cart.issues([
        { productId: lamp, quantity: 3, stock: 2 },
        { productId: chair, quantity: 1, stock: 4 },
      ]),
    ).toEqual([{ path: lamp, message: "Only 2 left." }]);
  });

  it("calls a line with no stock sold out", () => {
    expect(Cart.issues([{ productId: chair, quantity: 1, stock: 0 }])).toEqual([
      { path: chair, message: "Sold out." },
    ]);
  });

  it("has nothing to say about a cart within stock", () => {
    expect(Cart.issues([{ productId: lamp, quantity: 2, stock: 2 }])).toEqual([]);
  });
});
