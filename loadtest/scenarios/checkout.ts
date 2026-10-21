/**
 * A guest who buys: a cart of one product, the order placed with the
 * stack's simulated payment, and the order page polled until it is paid,
 * for up to ten seconds.
 */

import { check, sleep } from "k6";
import { Shop, type ShopData } from "../lib/shop.ts";

/** A delivery option as the checkout reads it. */
type Option = Readonly<{ code: string; priceCents: number; freeFromCents?: number }>;

export const Checkout = {
  run: (data: ShopData): void => {
    Shop.forget();
    const product = Shop.pick(data.products);

    Shop.step("fill cart", () => Shop.isOk(Shop.call("POST", "/cart/items", "add to cart", { body: { productId: product.id, quantity: 1 } }), "add to cart"));
    Shop.think();

    const placed: { orderId?: string; key?: string } = {};
    Shop.step("place order", () => {
      const cart = Shop.call("GET", "/cart", "cart");
      const methods = Shop.call("GET", "/shipping-methods", "shipping methods");
      if (!Shop.isOk(cart, "cart") || !Shop.isOk(methods, "shipping methods")) return false;

      const subtotal = (JSON.parse(cart.body as string) as Readonly<{ subtotalCents: number }>).subtotalCents;
      const option = (JSON.parse(methods.body as string) as Readonly<{ items: readonly Option[] }>).items[0];
      if (option === undefined) return false;

      const shipping = option.freeFromCents !== undefined && subtotal >= option.freeFromCents ? 0 : option.priceCents;
      const order = Shop.call("POST", "/orders", "place order", {
        body: {
          contact: { fullName: "Load Tester", email: `load-${__VU}-${__ITER}@example.com`, phone: "+372 5123 4567" },
          address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
          shippingMethod: option.code,
          expectedTotalCents: subtotal + shipping,
        },
      });
      if (!Shop.isOk(order, "place order")) return false;

      const result = JSON.parse(order.body as string) as Readonly<{ orderId: string; key?: string }>;
      placed.orderId = result.orderId;
      if (result.key !== undefined) {
        placed.key = result.key;
      }
      return true;
    });

    if (placed.orderId === undefined) return;

    Shop.step("wait for payment", () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const order = Shop.call("GET", `/orders/${placed.orderId}${placed.key === undefined ? "" : `?key=${placed.key}`}`, "order");
        if (!Shop.isOk(order, "order")) return false;
        if ((JSON.parse(order.body as string) as Readonly<{ status: string }>).status !== "pending_payment") {
          return check(order, { "order paid": () => true });
        }
        sleep(0.5);
      }
      return check(undefined, { "order paid within 10 seconds": () => false });
    });
    Shop.think();
  },
} as const;
