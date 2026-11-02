import { AddressCheck, ShippingAddress } from "@prism/shared"
import { useQuery } from "@tanstack/react-query"
import { match, P } from "ts-pattern"
import { Api } from "../../../shared/api/client.ts"
import { useDebounced } from "../../../shared/hooks/use-debounced.ts"

/** The address as it is being typed, whatever shape the form holds it in. */
export type AddressLookupProps = Readonly<{ address: unknown }>

/**
 * Whether the street exists where the typed address says. Once the address
 * passes the format check and typing stops, the page asks the server and
 * says what it found. Saving or placing an order asks again on the server.
 */
export const AddressLookup = ({ address }: AddressLookupProps) => {
  const parsed = ShippingAddress.schema.safeParse(address)

  const settled = useDebounced(parsed.success ? JSON.stringify(parsed.data) : undefined, 700)

  const check = useQuery({
    queryKey: ["checkout", "address", settled],
    queryFn: () => Api.post<AddressCheck>("/checkout/address", JSON.parse(settled ?? "{}")),
    enabled: settled !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  return (
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
  )
}
