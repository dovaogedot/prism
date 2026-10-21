import { Country } from "@prism/shared";
import { useWatch } from "react-hook-form";
import { Field, SelectField } from "../../../shared/ui/index.ts";
import type { CheckoutFormApi } from "../checkout.ts";

/** The form the fields belong to. */
export type BillingFieldsProps = Readonly<{ form: CheckoutFormApi }>;

/**
 * Where the bill goes. It goes to the shipping address unless the customer
 * unticks the box, which brings up an address of its own.
 */
export const BillingFields = ({ form }: BillingFieldsProps) => {
  const billing = useWatch({ control: form.control, name: "billingAddress" });

  const errors = form.formState.errors.billingAddress;
  const isSameAsShipping = billing === undefined;

  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-semibold text-ink">3. Billing address</legend>

      <label className="flex items-center gap-2.5 text-sm text-ink">
        <input
          className="size-4 accent-[var(--color-accent)]"
          type="checkbox"
          checked={isSameAsShipping}
          onChange={(event) => {
            if (event.target.checked) {
              form.unregister("billingAddress");
              return;
            }
            form.setValue("billingAddress", { line1: "", line2: "", city: "", postalCode: "", country: form.getValues("address.country") });
          }}
        />
        Same as the shipping address
      </label>

      {isSameAsShipping ? null : (
        <div className="space-y-4">
          <Field label="Street and house number" id="billing-line1" autoComplete="billing address-line1" error={errors?.line1?.message} {...form.register("billingAddress.line1")} />
          <Field
            label="Apartment, floor (optional)"
            id="billing-line2"
            autoComplete="billing address-line2"
            error={errors?.line2?.message}
            {...form.register("billingAddress.line2")}
          />
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field label="City" id="billing-city" autoComplete="billing address-level2" error={errors?.city?.message} {...form.register("billingAddress.city")} />
            <Field
              label="Postal code"
              id="billing-postal-code"
              autoComplete="billing postal-code"
              error={errors?.postalCode?.message}
              {...form.register("billingAddress.postalCode")}
            />
          </div>
          <SelectField label="Country" id="billing-country" autoComplete="billing country" error={errors?.country?.message} {...form.register("billingAddress.country")}>
            {Country.CODES.map((code) => (
              <option key={code} value={code}>
                {Country.name[code]}
              </option>
            ))}
          </SelectField>
        </div>
      )}
    </fieldset>
  );
};
