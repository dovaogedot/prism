import { useWatch } from "react-hook-form"
import { Field, PhoneField } from "../../../shared/ui/index.ts"
import type { CheckoutFormApi } from "../checkout.ts"

/** The form the fields belong to. */
export type ContactFieldsProps = Readonly<{ form: CheckoutFormApi }>

/** Who the order is for: name, email and phone. */
export const ContactFields = ({ form }: ContactFieldsProps) => {
  const errors = form.formState.errors.contact

  const phone = useWatch({ control: form.control, name: "contact.phone" })

  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-semibold text-ink">1. Contact</legend>

      <Field label="Full name" autoComplete="name" error={errors?.fullName?.message} {...form.register("contact.fullName")} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          hint="The confirmation goes here."
          error={errors?.email?.message}
          {...form.register("contact.email")}
        />
        <PhoneField
          label="Phone"
          typed={phone}
          hint="For the courier."
          error={errors?.phone?.message}
          {...form.register("contact.phone")}
        />
      </div>
    </fieldset>
  )
}
