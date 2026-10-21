/** A shopper who searches: suggestions as a name is typed, the results with a filter and a sort, then a product. */

import { Shop, type ShopData } from "../lib/shop.ts";

export const Search = {
  run: (data: ShopData): void => {
    const product = Shop.pick(data.products);
    const word = product.name.split(" ")[0] ?? product.name;

    Shop.step("type a name", () =>
      [2, 3, 4]
        .map((length) => Shop.isOk(Shop.call("GET", `/products/suggest?q=${encodeURIComponent(word.slice(0, length))}&limit=6`, "suggest"), "suggest"))
        .every(Boolean),
    );
    Shop.think();
    Shop.step("see results", () =>
      Shop.isOk(Shop.call("GET", `/products?q=${encodeURIComponent(word)}&sort=price_asc&rating=1`, "search results"), "search results"),
    );
    Shop.think();
    Shop.step("open product", () => Shop.isOk(Shop.call("GET", `/products/${product.slug}`, "product"), "product"));
    Shop.think();
  },
} as const;
