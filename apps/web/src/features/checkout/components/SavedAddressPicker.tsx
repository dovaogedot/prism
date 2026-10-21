import type { SavedAddress } from "@prism/shared";
import { useState } from "react";
import { SelectField } from "../../../shared/ui/index.ts";
import { SavedAddresses } from "../../account/account.ts";
import type { CheckoutFormApi } from "../checkout.ts";

/** The form the choice fills, and the customer's saved addresses. */
export type SavedAddressPickerProps = Readonly<{ form: CheckoutFormApi; addresses: readonly SavedAddress[] }>;

/**
 * A choice of the signed-in customer's saved addresses, starting at the
 * default one. Choosing one fills the name, phone and address fields;
 * choosing a new address empties the address fields to type into.
 */
export const SavedAddressPicker = ({ form, addresses }: SavedAddressPickerProps) => {
  const [chosen, setChosen] = useState(() => SavedAddresses.initial(addresses)?.id ?? "");

  const choose = (id: string): void => {
    setChosen(id);
    const options = { shouldDirty: true, shouldValidate: form.formState.isSubmitted };
    const saved = addresses.find((address) => address.id === id);

    if (saved === undefined) {
      form.setValue("address", { line1: "", line2: "", city: "", postalCode: "", country: form.getValues("address.country") }, options);
      return;
    }

    form.setValue("contact.fullName", saved.fullName, options);
    form.setValue("contact.phone", saved.phone, options);
    form.setValue("address", { ...saved.address, line2: saved.address.line2 ?? "" }, options);
  };

  return (
    <SelectField label="Ship to a saved address" id="saved-address" value={chosen} onChange={(event) => choose(event.target.value)}>
      {addresses.map((address) => (
        <option key={address.id} value={address.id}>
          {address.label}: {SavedAddresses.oneLine(address.address)}
        </option>
      ))}
      <option value="">A new address</option>
    </SelectField>
  );
};
