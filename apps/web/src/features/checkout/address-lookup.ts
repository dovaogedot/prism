/**
 * Whether an address exists is one verdict per address, shown in one place:
 * the line under the address fields. The live lookup and a refused save both
 * write it under the address's own key, so editing any part of the address
 * moves to that address's verdict and none is left behind on a field.
 */

import { AddressCheck, type ShippingAddress, type ValidationIssue } from "@prism/shared"
import type { QueryClient, QueryKey } from "@tanstack/react-query"

export const AddressLookups = {
  /** The cache key of the verdict on an address that passed the format check, given as its JSON. */
  keyOf: (json: string): QueryKey => ["checkout", "address", json],

  /**
   * Records the server's "not found" refusal of `address` as the verdict on
   * it, and hands back the other issues, which belong under their fields.
   */
  takeNotFound: (client: QueryClient, address: ShippingAddress, issues: readonly ValidationIssue[]): readonly ValidationIssue[] => {
    const isNotFound = (issue: ValidationIssue): boolean => issue.path === "address.line1" && issue.message === AddressCheck.NOT_FOUND

    if (issues.some(isNotFound)) client.setQueryData<AddressCheck>(AddressLookups.keyOf(JSON.stringify(address)), { status: "not_found" })

    return issues.filter((issue) => !isNotFound(issue))
  },
} as const
