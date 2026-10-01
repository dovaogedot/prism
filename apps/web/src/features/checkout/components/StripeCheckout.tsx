import type { CartView, CheckoutPrefill } from "@prism/shared";
import { useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckoutBody } from "./CheckoutBody.tsx";

/** The cart being bought, and what a signed-in customer starts with. */
export type StripeCheckoutProps = Readonly<{ cart: CartView; prefill?: CheckoutPrefill }>;

/** The checkout inside Stripe's `Elements`, handed the Stripe objects once Stripe.js has loaded. */
export const StripeCheckout = ({ cart, prefill }: StripeCheckoutProps) => {
  const stripe = useStripe();

  const elements = useElements();

  return (
    <CheckoutBody
      cart={cart}
      payments={stripe === null || elements === null ? { status: "loading" } : { status: "ready", stripe, elements }}
      {...(prefill === undefined ? {} : { prefill })}
    />
  );
};
