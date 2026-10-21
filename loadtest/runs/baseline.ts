/** One user in each scenario at once, for two minutes: the response times with no contention. */

import { Shop } from "../lib/shop.ts";
import { Summary } from "../lib/summary.ts";
import { Account } from "../scenarios/account.ts";
import { Browse } from "../scenarios/browse.ts";
import { Cart } from "../scenarios/cart.ts";
import { Checkout } from "../scenarios/checkout.ts";
import { Search } from "../scenarios/search.ts";

const Baseline = {
  /** One user running the scenario exported as `exec`, for two minutes. */
  oneUser: (exec: string) => ({ executor: "constant-vus", vus: 1, duration: "2m", exec }) as const,
} as const;

export const options = {
  insecureSkipTLSVerify: true,
  summaryTrendStats: Summary.TREND_STATS,
  thresholds: Summary.THRESHOLDS,
  scenarios: {
    browse: Baseline.oneUser("browse"),
    search: Baseline.oneUser("search"),
    cart: Baseline.oneUser("cart"),
    checkout: Baseline.oneUser("checkout"),
    account: Baseline.oneUser("account"),
  },
};

export const setup = Shop.load;
export const browse = Browse.run;
export const search = Search.run;
export const cart = Cart.run;
export const checkout = Checkout.run;
export const account = Account.run;
export const handleSummary = (data: Parameters<typeof Summary.of>[1]) => Summary.of("baseline", data);
