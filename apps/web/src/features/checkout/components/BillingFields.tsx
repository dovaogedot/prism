import { useWatch } from "react-hook-form"
import { PostalAddressFields } from "../../../shared/ui/index.ts"
import type { CheckoutFormApi } from "../checkout.ts"
import { useRecheck } from "../../../shared/hooks/use-recheck.ts"

/** The form the fields belong to. */
export type BillingFieldsProps = Readonly<{ form: CheckoutFormApi }>

/**
 * Where the bill goes. It goes to the shipping address unless the customer
 * unticks the box, which brings up an address of its own.
 */
export const BillingFields = ({ form }: BillingFieldsProps) => {
  useRecheck(form, "billingAddress.country", "billingAddress.postalCode")
  const billing = useWatch({ control: form.control, name: "billingAddress" })

  const errors = form.formState.errors.billingAddress
  const isSameAsShipping = billing === undefined

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
              form.unregister("billingAddress")
              return
            }
            form.setValue("billingAddress", { line1: "", line2: "", city: "", postalCode: "", country: form.getValues("address.country") })
          }}
        />
        Same as the shipping address
      </label>

      {isSameAsShipping ? null : (
        <div className="space-y-4">
          <PostalAddressFields
            idPrefix="billing"
            section="billing"
            country={billing.country}
            fields={{
              line1: { registered: form.register("billingAddress.line1"), error: errors?.line1?.message },
              line2: { registered: form.register("billingAddress.line2"), error: errors?.line2?.message },
              city: { registered: form.register("billingAddress.city"), error: errors?.city?.message },
              postalCode: { registered: form.register("billingAddress.postalCode"), error: errors?.postalCode?.message },
              country: {
                registered: form.register("billingAddress.country"),
                error: errors?.country?.message,
              },
            }}
          />
        </div>
      )}
    </fieldset>
  )
}
