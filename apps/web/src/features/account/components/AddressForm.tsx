import { SavedAddressInput, type SavedAddress } from "@prism/shared"
import { zodResolver } from "@hookform/resolvers/zod"
import { useId, useState, type ReactNode } from "react"
import { useForm, useWatch } from "react-hook-form"
import { Alert, Button, Field, PostalAddressFields } from "../../../shared/ui/index.ts"
import { ServerIssues } from "../../../shared/ui/server-issues.ts"
import { Failure } from "../../../shared/api/failure.tsx"
import { AddressLookup } from "../../checkout/components/index.ts"

/** The address being changed, or none for a new one; what saving does; and how to leave without saving. */
export type AddressFormProps = Readonly<{
  address?: SavedAddress
  onSave: (input: SavedAddressInput) => Promise<unknown>
  onCancel: () => void
}>

/** One saved address: what to call it, who receives the parcel, and where. */
export const AddressForm = ({ address, onSave, onCancel }: AddressFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined)

  // Two forms can be open at once, so every field id is unique to its form.
  const prefix = useId()

  const form = useForm({
    resolver: zodResolver(SavedAddressInput.schema),
    defaultValues: {
      label: address?.label ?? "",
      fullName: address?.fullName ?? "",
      phone: address?.phone ?? "",
      address: {
        line1: address?.address.line1 ?? "",
        line2: address?.address.line2 ?? "",
        city: address?.address.city ?? "",
        postalCode: address?.address.postalCode ?? "",
        country: address?.address.country ?? "EE",
      },
      isDefault: address?.isDefault ?? false,
    },
  })

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined)
    await onSave(values).catch((reason: unknown) =>
      // A refused field, such as an address the lookup cannot find, shows under that field.
      setFailure(
        Failure.describeUnplaced(reason, (issues) =>
          ServerIssues.place(issues, ["label", "fullName", "phone", "address", "isDefault"], form.setError),
        ),
      ),
    )
  })

  const errors = form.formState.errors

  const typed = useWatch({ control: form.control, name: "address" })
  const country = typed.country

  return (
    <form className="space-y-4 rounded-lg border border-line bg-surface p-5" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      <Field
        label="Name of the address"
        id={`${prefix}-label`}
        placeholder="Home"
        error={errors.label?.message}
        {...form.register("label")}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Full name"
          id={`${prefix}-name`}
          autoComplete="name"
          error={errors.fullName?.message}
          {...form.register("fullName")}
        />
        <Field
          label="Phone"
          id={`${prefix}-phone`}
          type="tel"
          autoComplete="tel"
          error={errors.phone?.message}
          {...form.register("phone")}
        />
      </div>
      <PostalAddressFields
        idPrefix={prefix}
        country={country}
        fields={{
          line1: { registered: form.register("address.line1"), error: errors.address?.line1?.message },
          line2: { registered: form.register("address.line2"), error: errors.address?.line2?.message },
          city: { registered: form.register("address.city"), error: errors.address?.city?.message },
          postalCode: { registered: form.register("address.postalCode"), error: errors.address?.postalCode?.message },
          country: { registered: form.register("address.country"), error: errors.address?.country?.message },
        }}
      />
      <AddressLookup address={typed} />

      <label className="flex items-center gap-2.5 text-sm text-ink">
        <input className="size-4 accent-[var(--color-accent)]" type="checkbox" {...form.register("isDefault")} />
        Start checkout with this address
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" busy={form.formState.isSubmitting}>
          {address === undefined ? "Add address" : "Save address"}
        </Button>
        <Button tone="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
