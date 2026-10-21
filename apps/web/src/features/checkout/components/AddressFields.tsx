import { AddressCheck, Country, ShippingAddress } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { useWatch } from "react-hook-form";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Field } from "../../../shared/ui/index.ts";
import type { CheckoutFormApi } from "../checkout.ts";
import { useDebounced } from "../../../shared/hooks/use-debounced.ts";

/** The form the fields belong to. */
export type AddressFieldsProps = Readonly<{ form: CheckoutFormApi }>;

/**
 * Where the parcel goes. Once the address passes the format check and the
 * customer stops typing, the page asks whether the street exists there, and
 * says so under the fields. Placing the order asks again on the server.
 */
export const AddressFields = ({ form }: AddressFieldsProps) => {
  const errors = form.formState.errors.address;

  const typed = useWatch({ control: form.control, name: "address" });

  const parsed = ShippingAddress.schema.safeParse(typed);

  const settled = useDebounced(parsed.success ? JSON.stringify(parsed.data) : undefined, 700);

  const check = useQuery({
    queryKey: ["checkout", "address", settled],
    queryFn: () => Api.post<AddressCheck>("/checkout/address", JSON.parse(settled ?? "{}")),
    enabled: settled !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const country = typed.country;

  return (
    <fieldset className="space-y-4">
      <legend className="mb-3 text-base font-semibold text-ink">2. Shipping address</legend>

      <Field
        label="Street and house number"
        autoComplete="address-line1"
        error={errors?.line1?.message}
        {...form.register("address.line1")}
      />
      <Field
        label="Apartment, floor (optional)"
        autoComplete="address-line2"
        error={errors?.line2?.message}
        {...form.register("address.line2")}
      />

      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="City" autoComplete="address-level2" error={errors?.city?.message} {...form.register("address.city")} />
        <Field
          label="Postal code"
          autoComplete="postal-code"
          placeholder={Country.postalCodeExample[country]}
          error={errors?.postalCode?.message}
          {...form.register("address.postalCode")}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="address.country" className="block text-sm font-medium text-ink">
          Country
        </label>
        <select
          id="address.country"
          autoComplete="country"
          aria-invalid={errors?.country !== undefined}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink hover:border-line-strong"
          {...form.register("address.country")}
        >
          {Country.CODES.map((code) => (
            <option key={code} value={code}>
              {Country.name[code]}
            </option>
          ))}
        </select>
        {errors?.country?.message === undefined ? null : (
          <p role="alert" className="text-sm text-danger">
            {errors.country.message}
          </p>
        )}
      </div>

      <div aria-live="polite" className="min-h-5 text-sm">
        {match({ settled, check })
          .with({ settled: P.nullish }, () => null)
          .with({ check: { status: "pending" } }, () => <span className="text-ink-faint">Checking the address…</span>)
          .with({ check: { data: { status: "verified" } } }, () => <span className="text-accent">✓ Address found.</span>)
          .with({ check: { data: { status: "not_found" } } }, () => <span className="text-warn">{AddressCheck.NOT_FOUND}</span>)
          .otherwise(() => (
            <span className="text-ink-faint">We could not check the address right now; its format is fine.</span>
          ))}
      </div>
    </fieldset>
  );
};
