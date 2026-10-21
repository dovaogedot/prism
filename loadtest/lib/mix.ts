/** The mixed workload: each iteration is one scenario, drawn with the weights of a shop's funnel. */

import { Account } from "../scenarios/account.ts";
import { Browse } from "../scenarios/browse.ts";
import { Cart } from "../scenarios/cart.ts";
import { Checkout } from "../scenarios/checkout.ts";
import { Search } from "../scenarios/search.ts";
import type { ShopData } from "./shop.ts";

export const Mix = {
  /** Each scenario's share of the iterations, in percent. */
  WEIGHTS: [
    ["browse", 50],
    ["search", 25],
    ["cart", 15],
    ["checkout", 5],
    ["account", 5],
  ] as const,

  scenarios: {
    browse: Browse.run,
    search: Search.run,
    cart: Cart.run,
    checkout: Checkout.run,
    account: Account.run,
  } as const satisfies Record<string, (data: ShopData) => void>,

  /** Runs one scenario, drawn by weight. */
  run: (data: ShopData): void => {
    const roll = Math.random() * 100;
    let reached = 0;

    for (const [name, weight] of Mix.WEIGHTS) {
      reached += weight;
      if (roll < reached) {
        Mix.scenarios[name](data);
        return;
      }
    }
  },
} as const;
