import { Price, type CartView, type Totals } from "@prism/shared";
import { CartLineItem } from "../../cart/components/index.ts";

/** The cart being bought and its totals. */
export type OrderSummaryProps = Readonly<{ cart: CartView; totals: Totals }>;

/** Every line with a stepper and a remove button, then the subtotal, shipping and total. */
export const OrderSummary = ({ cart, totals }: OrderSummaryProps) => (
  <div className="space-y-4">
    <ul className="divide-y divide-line">
      {cart.lines.map((line) => (
        <CartLineItem key={line.productId} line={line} compact />
      ))}
    </ul>

    <dl className="space-y-2 border-t border-line pt-4 text-sm">
      <div className="flex justify-between">
        <dt className="text-ink-soft">Subtotal</dt>
        <dd className="tabular-nums text-ink">{Price.format(totals.subtotalCents)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-ink-soft">Shipping</dt>
        <dd className="tabular-nums text-ink">{totals.shippingCents === 0 ? "Free" : Price.format(totals.shippingCents)}</dd>
      </div>
      <div className="flex justify-between border-t border-line pt-2 text-base font-semibold">
        <dt className="text-ink">Total</dt>
        <dd className="tabular-nums text-ink">{Price.format(totals.totalCents)}</dd>
      </div>
    </dl>
    <p className="text-xs text-ink-faint">Prices include VAT.</p>
  </div>
);
