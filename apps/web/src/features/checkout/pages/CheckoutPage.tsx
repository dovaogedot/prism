import { Pricing, type CheckoutPrefill, type ShippingOption } from "@prism/shared"
import { Elements } from "@stripe/react-stripe-js"
import { useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import { Link } from "react-router"
import { match, P } from "ts-pattern"
import { Api } from "../../../shared/api/client.ts"
import { useTheme } from "../../../shared/theme/use-theme.ts"
import { Alert, Button, Card, Skeleton } from "../../../shared/ui/index.ts"
import { Failure } from "../../../shared/api/failure.tsx"
import { useSession } from "../../auth/session.ts"
import { AccountKeys, useSavedAddresses } from "../../account/account.ts"
import { useCart } from "../../cart/cart.ts"
import { StripeFields, usePaymentsConfig, useStripeJs } from "../checkout.ts"
import { CheckoutBody, StripeCheckout } from "../components/index.ts"
import { PageMeta } from "../../../shared/seo/PageMeta.tsx"
import { PageText } from "../../../shared/seo/page-text.ts"
import { useShippingOptions } from "../../../shared/api/shipping-options.ts"

/**
 * Checkout on one page. It waits for the cart, the payment settings, the
 * delivery options and, for a signed-in customer, the prefill, so the form
 * starts complete.
 */
export const CheckoutPage = () => {
  const session = useSession()

  const { theme } = useTheme()

  const cart = useCart()

  const config = usePaymentsConfig()

  const options = useShippingOptions()

  // Starts as soon as the shop says it takes cards, beside the other reads.
  const stripeJs = useStripeJs(config.data?.provider === "stripe" ? config.data.publishableKey : undefined)

  const prefill = useQuery({
    queryKey: AccountKeys.checkoutPrefill(session?.id),
    queryFn: ({ signal }) => Api.get<CheckoutPrefill>("/checkout/prefill", signal),
    enabled: session !== undefined,
    retry: false,
  })

  const saved = useSavedAddresses()

  // The amount Stripe's fields start from. Elements applies an option it sees
  // change after CheckoutBody has set the chosen option's total, so it only
  // ever sees this first one, and CheckoutBody keeps the amount current.
  const startingAmount = useRef<number | undefined>(undefined)

  // A failed prefill only means an empty form; it never blocks checkout.
  const prefillSettled = session === undefined || (prefill.status !== "pending" && saved.status !== "pending")

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <PageMeta title={PageText.checkout.title} description={PageText.checkout.description} isIndexed={false} />
      <div className="mb-6 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Checkout</h1>
        <Link to="/cart" className="text-sm text-ink-soft hover:text-ink">
          Back to cart
        </Link>
      </div>

      {/* A failed refetch keeps the data it had, so only a first load that failed replaces the form. */}
      {match({ cart, config, options, prefillSettled })
        .with({ cart: { status: "error", data: P.nullish } }, ({ cart: { error } }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ config: { status: "error", data: P.nullish } }, ({ config: { error } }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ options: { status: "error", data: P.nullish } }, ({ options: { error } }) => <Alert>{Failure.message(error)}</Alert>)
        .with(
          P.union(
            { cart: { data: P.nullish } },
            { config: { data: P.nullish } },
            { options: { data: P.nullish } },
            { prefillSettled: false },
          ),
          () => (
            <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
              <Skeleton className="h-[32rem] w-full" />
              <Skeleton className="h-64 w-full" />
            </div>
          ),
        )
        .with({ cart: { data: { lines: [] } } }, () => (
          <Card className="space-y-3 p-8 text-center">
            <p className="text-ink">Your cart is empty, so there is nothing to check out.</p>
            <Link to="/shop" className="text-sm font-medium text-accent hover:underline">
              Browse the shop
            </Link>
          </Card>
        ))
        .otherwise(({ cart: { data: view }, config: { data: payments }, options: { data: offered } }) => {
          if (view === undefined || payments === undefined || offered === undefined) return null

          const [first, ...rest] = offered
          if (first === undefined) {
            return (
              <Alert title="Delivery is paused">
                No delivery options are offered right now, so orders cannot be placed. Try again later.
              </Alert>
            )
          }

          const choices: readonly [ShippingOption, ...ShippingOption[]] = [first, ...rest]
          const known = {
            ...(prefill.data === undefined ? {} : { prefill: prefill.data }),
            ...(session === undefined ? {} : { savedAddresses: saved.data ?? [] }),
          }

          if (payments.provider === "unavailable") {
            return <CheckoutBody cart={view} options={choices} payments={{ status: "unavailable" }} {...known} />
          }
          if (payments.provider === "simulated") {
            return <CheckoutBody cart={view} options={choices} payments={{ status: "simulated" }} {...known} />
          }

          startingAmount.current ??= Pricing.totals(view.lines, first).totalCents

          return (
            <div className="space-y-6">
              {stripeJs.status === "error" ? (
                <Alert title="The card fields did not load">
                  <p>Stripe's payment form could not be reached. Check the connection and try again; what you typed stays.</p>
                  <Button className="mt-3" tone="quiet" type="button" busy={stripeJs.isFetching} onClick={() => void stripeJs.refetch()}>
                    Try again
                  </Button>
                </Alert>
              ) : null}

              <Elements
                stripe={stripeJs.data ?? null}
                options={{
                  mode: "payment",
                  amount: startingAmount.current,
                  currency: "eur",
                  allowedPaymentMethodTypes: ["card"],
                  appearance: StripeFields.appearance(theme === "dark"),
                }}
              >
                <StripeCheckout cart={view} options={choices} {...known} />
              </Elements>
            </div>
          )
        })}
    </div>
  )
}
