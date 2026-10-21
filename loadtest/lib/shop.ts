/**
 * What every load scenario shares: where the shop is, the user steps counted
 * as transactions, the pause a person takes between steps, and the catalog
 * the scenarios pick from.
 */

import { check, group, sleep } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

/** What `setup` reads from the shop once, for every user to pick from. */
export type ShopData = Readonly<{
  products: readonly Readonly<{ id: string; slug: string; name: string }>[];
  categories: readonly string[];
}>;

export const Shop = {
  /** The storefront's address: the web service, from inside the load test's network. */
  BASE: __ENV["BASE_URL"] ?? "https://web:3000",

  /** Every user step taken, so a run reports transactions per second beside requests. */
  transactions: new Counter("transactions"),
  /** Whether each step got every answer it expected. */
  transactionSuccess: new Rate("transaction_success"),

  /** One user step, as a k6 group: counted, and successful when `act` says every answer was as expected. */
  step: (name: string, act: () => boolean): void => {
    group(name, () => {
      const isOk = act();
      Shop.transactions.add(1);
      Shop.transactionSuccess.add(isOk);
    });
  },

  /** The pause a person takes between steps: one to three seconds. */
  think: (): void => {
    sleep(1 + Math.random() * 2);
  },

  /** Whether `response` answered 2xx, recorded as a check named after the request. */
  isOk: (response: http.RefinedResponse<http.ResponseType | undefined>, name: string): boolean =>
    check(response, { [`${name} answered 2xx`]: (answer) => answer.status >= 200 && answer.status < 300 }),

  /** One request to the API, tagged with `name` so the report counts it under that name. */
  call: (
    method: "GET" | "POST" | "PUT",
    path: string,
    name: string,
    options: Readonly<{ body?: unknown; token?: string }> = {},
  ): http.RefinedResponse<"text"> =>
    http.request(method, `${Shop.BASE}/api/v1${path}`, options.body === undefined ? null : JSON.stringify(options.body), {
      headers: {
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
      },
      tags: { name },
    }),

  pick: <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T,

  /** A new guest: this user's cookies, and so its cart and session, are forgotten. */
  forget: (): void => {
    http.cookieJar().clear(Shop.BASE);
  },

  /** Reads the catalog the scenarios pick from. Runs once, before any user starts. */
  load: (): ShopData => {
    const products = JSON.parse(Shop.call("GET", "/products?perPage=100&sort=rating", "setup").body as string) as Readonly<{
      items: readonly Readonly<{ id: string; slug: string; name: string }>[];
    }>;
    const categories = JSON.parse(Shop.call("GET", "/categories", "setup").body as string) as Readonly<{ items: readonly Readonly<{ slug: string }>[] }>;

    return {
      products: products.items.map((item) => ({ id: item.id, slug: item.slug, name: item.name })),
      categories: categories.items.map((category) => category.slug),
    };
  },
} as const;
