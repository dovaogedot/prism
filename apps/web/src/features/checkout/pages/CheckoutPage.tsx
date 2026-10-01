import { Pricing, type CheckoutPrefill } from "@prism/shared";
import { Elements } from "@stripe/react-stripe-js";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useTheme } from "../../../shared/theme/use-theme.ts";
import { Alert, Card, Skeleton } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useSession } from "../../auth/session.ts";
import { useCart } from "../../cart/cart.ts";
import { StripeLoader, usePaymentsConfig } from "../checkout.ts";
import { CheckoutBody, StripeCheckout } from "../components/index.ts";

/**
 * Checkout on one page. It waits for the cart, the payment settings and, for
 * a signed-in customer, the prefill, so the form starts complete.
 */
export const CheckoutPage = () => {
  const session = useSession();

  const { theme } = useTheme();

  const cart = useCart();

  const config = usePaymentsConfig();

  const prefill = useQuery({
    queryKey: ["checkout", "prefill", session?.id],
    queryFn: ({ signal }) => Api.get<CheckoutPrefill>("/checkout/prefill", signal),
    enabled: session !== undefined,
    retry: false,
  });

  // A failed prefill only means an empty form; it never blocks checkout.
  const prefillSettled = session === undefined || prefill.status !== "pending";

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Checkout</h1>
        <Link to="/cart" className="text-sm text-ink-soft hover:text-ink">
          Back to cart
        </Link>
      </div>

      {match({ cart, config, prefillSettled })
        .with({ cart: { status: "error" } }, ({ cart: { error } }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ config: { status: "error" } }, ({ config: { error } }) => <Alert>{Failure.message(error)}</Alert>)
        .with(P.union({ cart: { data: P.nullish } }, { config: { data: P.nullish } }, { prefillSettled: false }), () => (
          <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
            <Skeleton className="h-[32rem] w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))
        .with({ cart: { data: { lines: [] } } }, () => (
          <Card className="space-y-3 p-8 text-center">
            <p className="text-ink">Your cart is empty, so there is nothing to check out.</p>
            <Link to="/" className="text-sm font-medium text-accent hover:underline">
              Browse the shop
            </Link>
          </Card>
        ))
        .otherwise(({ cart: { data: view }, config: { data: payments } }) => {
          const known = prefill.data === undefined ? {} : { prefill: prefill.data };

          if (view === undefined || payments === undefined) return null;
          if (payments.provider === "unavailable") {
            return <CheckoutBody cart={view} payments={{ status: "unavailable" }} {...known} />;
          }

          return (
            <Elements
              stripe={StripeLoader.load(payments.publishableKey)}
              options={{
                mode: "payment",
                amount: Pricing.totals(view.lines, "standard").totalCents,
                currency: "eur",
                allowedPaymentMethodTypes: ["card"],
                appearance: StripeLoader.appearance(theme === "dark"),
              }}
            >
              <StripeCheckout cart={view} {...known} />
            </Elements>
          );
        })}
    </div>
  );
};
