import { Delivery, Price, Pricing, ShippingOption } from "@prism/shared";
import { useWatch } from "react-hook-form";
import { DeliveryDates } from "../../../shared/format/delivery-dates.ts";
import type { CheckoutFormApi } from "../checkout.ts";

/** The form the choice belongs to, the options offered, and the subtotal the prices depend on. */
export type ShippingOptionsProps = Readonly<{
  form: CheckoutFormApi;
  options: readonly ShippingOption[];
  subtotalCents: number;
}>;

/** Each delivery option, with what it costs for this cart and the days it should arrive between. */
export const ShippingOptions = ({ form, options, subtotalCents }: ShippingOptionsProps) => {
  const chosen = useWatch({ control: form.control, name: "shippingMethod" });

  const error = form.formState.errors.shippingMethod?.message;
  const today = new Date();

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-base font-semibold text-ink">4. Delivery</legend>

      {options.map((option) => {
        const cost = Pricing.shipping(option, subtotalCents);
        const window = DeliveryDates.format(Delivery.estimate(today, option));

        return (
          <label
            key={option.code}
            className={`flex items-center gap-3 rounded-lg border p-3.5 transition-colors ${
              chosen === option.code ? "border-accent bg-accent-wash" : "border-line hover:border-line-strong"
            }`}
          >
            <input type="radio" value={option.code} className="accent-[var(--color-accent)]" {...form.register("shippingMethod")} />
            <span className="flex-1">
              <span className="block text-sm font-medium text-ink">{option.name}</span>
              <span className="block text-sm text-ink-soft">
                Arrives {window} ({ShippingOption.windowOf(option)})
              </span>
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
