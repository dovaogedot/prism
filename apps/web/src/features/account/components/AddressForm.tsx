import { Country, SavedAddressInput, type SavedAddress } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Alert, Button, Field, SelectField } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";

/** The address being changed, or none for a new one; what saving does; and how to leave without saving. */
export type AddressFormProps = Readonly<{
  address?: SavedAddress;
  onSave: (input: SavedAddressInput) => Promise<unknown>;
  onCancel: () => void;
}>;

/** One saved address: what to call it, who receives the parcel, and where. */
export const AddressForm = ({ address, onSave, onCancel }: AddressFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  // Two forms can be open at once, so every field id is unique to its form.
  const prefix = useId();

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
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);
    await onSave(values).catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  const errors = form.formState.errors;

  return (
    <form className="space-y-4 rounded-lg border border-line bg-surface p-5" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      <Field label="Name of the address" id={`${prefix}-label`} placeholder="Home" error={errors.label?.message} {...form.register("label")} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" id={`${prefix}-name`} autoComplete="name" error={errors.fullName?.message} {...form.register("fullName")} />
        <Field label="Phone" id={`${prefix}-phone`} type="tel" autoComplete="tel" error={errors.phone?.message} {...form.register("phone")} />
      </div>
      <Field
        label="Street and house number"
        id={`${prefix}-line1`}
        autoComplete="address-line1"
        error={errors.address?.line1?.message}
        {...form.register("address.line1")}
      />
      <Field
        label="Apartment, floor (optional)"
        id={`${prefix}-line2`}
        autoComplete="address-line2"
        error={errors.address?.line2?.message}
        {...form.register("address.line2")}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="City" id={`${prefix}-city`} autoComplete="address-level2" error={errors.address?.city?.message} {...form.register("address.city")} />
        <Field
          label="Postal code"
          id={`${prefix}-postal-code`}
          autoComplete="postal-code"
          error={errors.address?.postalCode?.message}
          {...form.register("address.postalCode")}
        />
      </div>
      <SelectField label="Country" id={`${prefix}-country`} autoComplete="country" error={errors.address?.country?.message} {...form.register("address.country")}>
        {Country.CODES.map((code) => (
          <option key={code} value={code}>
            {Country.name[code]}
          </option>
        ))}
      </SelectField>

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
  );
};
