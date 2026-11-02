import { useWatch } from "react-hook-form"
import { PostalAddressFields } from "../../../shared/ui/index.ts"
import type { CheckoutFormApi } from "../checkout.ts"
import { AddressLookup } from "./AddressLookup.tsx"

/** The form the fields belong to. */
export type AddressFieldsProps = Readonly<{ form: CheckoutFormApi }>

/** Where the parcel goes, and under the fields whether the street exists there. */
export const AddressFields = ({ form }: AddressFieldsProps) => {
  const errors = form.formState.errors.address

  const typed = useWatch({ control: form.control, name: "address" })

  const country = typed.country

  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-semibold text-ink">2. Shipping address</legend>

      <PostalAddressFields
        idPrefix="address"
        country={country}
        fields={{
          line1: { registered: form.register("address.line1"), error: errors?.line1?.message },
          line2: { registered: form.register("address.line2"), error: errors?.line2?.message },
          city: { registered: form.register("address.city"), error: errors?.city?.message },
          postalCode: { registered: form.register("address.postalCode"), error: errors?.postalCode?.message },
          country: { registered: form.register("address.country", { deps: ["address.postalCode"] }), error: errors?.country?.message },
        }}
      />

      <AddressLookup address={typed} />
    </fieldset>
  )
}
