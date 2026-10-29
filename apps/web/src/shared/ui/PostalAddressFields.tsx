import { Country } from "@prism/shared"
import type { UseFormRegisterReturn } from "react-hook-form"
import { Field } from "./Field.tsx"
import { SelectField } from "./SelectField.tsx"

/** One field of a postal address: what its form registered, and the error to show under it, if any. */
export type PostalAddressField = Readonly<{ registered: UseFormRegisterReturn; error: string | undefined }>

/** The five fields of an address and where their ids and autofill come from. */
export type PostalAddressFieldsProps = Readonly<{
  /** Starts every field's id, so two addresses on one page never share one. */
  idPrefix: string
  /** The autofill section, such as "billing"; left out for the address the parcel goes to. */
  section?: string
  /** The country chosen, whose postal code format is shown as the example. */
  country: Country
  fields: Readonly<{
    line1: PostalAddressField
    line2: PostalAddressField
    city: PostalAddressField
    postalCode: PostalAddressField
    country: PostalAddressField
  }>
}>

/** A postal address: street, apartment, city, postal code and country, the same in every form. */
export const PostalAddressFields = ({ idPrefix, section, country, fields }: PostalAddressFieldsProps) => {
  const autofill = (token: string): string => (section === undefined ? token : `${section} ${token}`)

  return (
    <>
      <Field
        label="Street and house number"
        id={`${idPrefix}-line1`}
        autoComplete={autofill("address-line1")}
        error={fields.line1.error}
        {...fields.line1.registered}
      />
      <Field
        label="Apartment, floor (optional)"
        id={`${idPrefix}-line2`}
        autoComplete={autofill("address-line2")}
        error={fields.line2.error}
        {...fields.line2.registered}
      />
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field
          label="City"
          id={`${idPrefix}-city`}
          autoComplete={autofill("address-level2")}
          error={fields.city.error}
          {...fields.city.registered}
        />
        <Field
          label="Postal code"
          id={`${idPrefix}-postal-code`}
          autoComplete={autofill("postal-code")}
          placeholder={Country.postalCodeExample[country]}
          error={fields.postalCode.error}
          {...fields.postalCode.registered}
        />
      </div>
      <SelectField
        label="Country"
        id={`${idPrefix}-country`}
        autoComplete={autofill("country")}
        error={fields.country.error}
        {...fields.country.registered}
      >
        {Country.CODES.map((code) => (
          <option key={code} value={code}>
            {Country.name[code]}
          </option>
        ))}
      </SelectField>
    </>
  )
}
