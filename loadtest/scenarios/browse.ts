/** A shopper who looks around: the home page, a category and its second page, then a product with its reviews and related products. */

import { Shop, type ShopData } from "../lib/shop.ts";

export const Browse = {
  run: (data: ShopData): void => {
    const category = Shop.pick(data.categories);
    const product = Shop.pick(data.products);

    Shop.step("open home", () => Shop.isOk(Shop.call("GET", "/home", "home"), "home"));
    Shop.think();
    Shop.step("open category", () => Shop.isOk(Shop.call("GET", `/products?category=${category}`, "category"), "category"));
    Shop.think();
    Shop.step("next page", () => Shop.isOk(Shop.call("GET", `/products?category=${category}&page=2`, "category page 2"), "category page 2"));
    Shop.think();
    Shop.step("open product", () =>
      [
        Shop.isOk(Shop.call("GET", `/products/${product.slug}`, "product"), "product"),
        Shop.isOk(Shop.call("GET", `/products/${product.slug}/reviews`, "reviews"), "reviews"),
        Shop.isOk(Shop.call("GET", `/products/${product.slug}/related`, "related"), "related"),
      ].every(Boolean),
    );
    Shop.think();
  },
} as const;
