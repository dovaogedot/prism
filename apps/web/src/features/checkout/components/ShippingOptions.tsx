import { Price, Pricing, ShippingMethod } from "@prism/shared";
import { useWatch } from "react-hook-form";
import type { CheckoutFormApi } from "../checkout.ts";

/** The form the choice belongs to, and the subtotal the prices depend on. */
export type ShippingOptionsProps = Readonly<{ form: CheckoutFormApi; subtotalCents: number }>;

/** Standard or express, each with what it costs for this cart and how long it takes. */
export const ShippingOptions = ({ form, subtotalCents }: ShippingOptionsProps) => {
  const chosen = useWatch({ control: form.control, name: "shippingMethod" });

  const error = form.formState.errors.shippingMethod?.message;

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-base font-semibold text-ink">3. Shipping</legend>

      {ShippingMethod.NAMES.map((method) => {
        const cost = Pricing.shipping(method, subtotalCents);

        return (
          <label
            key={method}
            className={`flex items-center gap-3 rounded-lg border p-3.5 transition-colors ${
              chosen === method ? "border-accent bg-accent-wash" : "border-line hover:border-line-strong"
            }`}
          >
            <input type="radio" value={method} className="accent-[var(--color-accent)]" {...form.register("shippingMethod")} />
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">{ShippingMethod.label[method]}</span>
              <span className="block text-sm text-ink-soft">{ShippingMethod.estimate[method]}</span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-ink">{cost === 0 ? "Free" : Price.format(cost)}</span>
          </label>
        );
      })}

      {error === undefined ? null : (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
};
