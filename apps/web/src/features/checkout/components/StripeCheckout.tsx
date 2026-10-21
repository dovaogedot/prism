import type { CartView, CheckoutPrefill, SavedAddress, ShippingOption } from "@prism/shared";
import { useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckoutBody } from "./CheckoutBody.tsx";

/** The cart being bought, the delivery options, and what a signed-in customer starts with. */
export type StripeCheckoutProps = Readonly<{
  cart: CartView;
  options: readonly [ShippingOption, ...ShippingOption[]];
  prefill?: CheckoutPrefill;
  /** The signed-in customer's saved addresses; absent for a guest. */
  savedAddresses?: readonly SavedAddress[];
}>;

/** The checkout inside Stripe's `Elements`, handed the Stripe objects once Stripe.js has loaded. */
export const StripeCheckout = ({ cart, options, prefill, savedAddresses }: StripeCheckoutProps) => {
  const stripe = useStripe();

  const elements = useElements();

  return (
    <CheckoutBody
      cart={cart}
      options={options}
      payments={stripe === null || elements === null ? { status: "loading" } : { status: "ready", stripe, elements }}
      {...(prefill === undefined ? {} : { prefill })}
      {...(savedAddresses === undefined ? {} : { savedAddresses })}
    />
  );
};
