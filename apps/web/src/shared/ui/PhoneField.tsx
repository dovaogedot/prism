import { PhoneNumber } from "@prism/shared"
import { lazy, Suspense } from "react"
import { Field, type FieldProps } from "./Field.tsx"

// Every country's flag is a large set, so it loads with the first phone field rather than with every page.
const CountryFlag = lazy(() => import("./CountryFlag.tsx").then((module) => ({ default: module.CountryFlag })))

/** A phone `Field`, plus the number as typed so far, whose country code picks the flag. */
export type PhoneFieldProps = Omit<FieldProps, "type" | "leading"> & Readonly<{ typed: string }>

/**
 * A phone number with its country code: the field shows the flag of the
 * country the number belongs to, and puts a space after the code once it is
 * typed. A handset stands in until the digits name a country.
 */
export const PhoneField = ({ typed, onChange, ...rest }: PhoneFieldProps) => {
  const country = PhoneNumber.findCountry(typed)

  return (
    <Field
      type="tel"
      autoComplete="tel"
      placeholder="+372 5123 4567"
      {...rest}
      leading={
        country === undefined ? (
          <svg className="size-4 text-ink-faint" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
          </svg>
        ) : (
          <Suspense fallback={null}>
            <CountryFlag country={country} className="h-3.5 w-5 rounded-[2px] shadow-[0_0_0_1px_rgb(0_0_0/0.15)]" />
          </Suspense>
        )
      }
      onChange={(event) => {
        const spaced = PhoneNumber.spaceAfterCode(event.target.value)
        if (spaced !== event.target.value) event.target.value = spaced
        void onChange?.(event)
      }}
    />
  )
}
