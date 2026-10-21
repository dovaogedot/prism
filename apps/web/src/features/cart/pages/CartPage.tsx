import { Cart, Price } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Failure } from "../../auth/components/failure.tsx";
import { Alert, Card, Skeleton } from "../../../shared/ui/index.ts";
import { useShippingOptions } from "../../checkout/checkout.ts";
import { FreeShipping, useCart } from "../cart.ts";
import { CartLineItem, Recommendations } from "../components/index.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";

/**
 * The cart: every line with its picture, price and quantity, the subtotal,
 * the way to checkout, and products to go with it.
 */
export const CartPage = () => {
  const cart = useCart();

  const options = useShippingOptions();

  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 py-8 sm:px-6">
      <div className="space-y-6">
        <PageMeta title={PageText.cart.title} description={PageText.cart.description} isIndexed={false} />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your cart</h1>

        {match(cart)
          .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
          .with({ data: P.nullish }, () => (
            <div className="space-y-4">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))
          .with({ data: { lines: [] } }, () => (
            <Card className="space-y-3 p-8 text-center">
              <p className="text-ink">Your cart is empty.</p>
              <Link to="/" className="text-sm font-medium text-accent hover:underline">
                Browse the shop
              </Link>
            </Card>
          ))
          .otherwise(({ data }) => {
            const blocked = Cart.issues(data.lines).length > 0;
            const freeShipping = FreeShipping.sentenceOf(options.data ?? [], data.subtotalCents);

            return (
              <div className="grid gap-8 lg:grid-cols-[1fr_20rem] lg:items-start">
                <ul className="divide-y divide-line border-y border-line">
                  {data.lines.map((line) => (
                    <CartLineItem key={line.productId} line={line} />
                  ))}
                </ul>

                <Card className="space-y-4 p-5 lg:sticky lg:top-24">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm text-ink-soft">
                      Subtotal ({data.itemCount} item{data.itemCount === 1 ? "" : "s"})
                    </span>
                    <span className="text-lg font-semibold tabular-nums text-ink">{Price.format(data.subtotalCents)}</span>
                  </div>

                  <p className="text-sm text-ink-soft">
                    {freeShipping === undefined ? null : `${freeShipping} `}
                    Prices include VAT.
                  </p>

                  {blocked ? (
                    <p role="alert" className="text-sm text-danger">
                      Some items are not available in that quantity. Fix them above to check out.
                    </p>
                  ) : null}

                  <Link
                    to="/checkout"
                    aria-disabled={blocked}
                    onClick={(event) => {
                      if (blocked) event.preventDefault();
                    }}
                    className={`flex w-full items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
                      blocked
                        ? "pointer-events-none bg-sunken text-ink-faint"
                        : "bg-accent text-accent-ink hover:bg-accent-hover"
                    }`}
                  >
                    Go to checkout
                  </Link>
                </Card>
              </div>
            );
          })}
      </div>

      <Recommendations />
    </div>
  );
};
