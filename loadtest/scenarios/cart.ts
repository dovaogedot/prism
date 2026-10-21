/** A guest who fills a cart: one to three products, a quantity changed, then the cart with its recommendations. */

import { Shop, type ShopData } from "../lib/shop.ts";

export const Cart = {
  run: (data: ShopData): void => {
    Shop.forget();
    const chosen = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => Shop.pick(data.products));

    for (const product of chosen) {
      Shop.step("add to cart", () => Shop.isOk(Shop.call("POST", "/cart/items", "add to cart", { body: { productId: product.id, quantity: 1 } }), "add to cart"));
      Shop.think();
    }

    const first = chosen[0];
    if (first !== undefined) {
      Shop.step("change quantity", () => Shop.isOk(Shop.call("PUT", `/cart/items/${first.id}`, "change quantity", { body: { quantity: 2 } }), "change quantity"));
      Shop.think();
    }

    Shop.step("open cart", () =>
      [Shop.isOk(Shop.call("GET", "/cart", "cart"), "cart"), Shop.isOk(Shop.call("GET", "/cart/recommendations", "recommendations"), "recommendations")].every(Boolean),
    );
    Shop.think();
  },
} as const;
