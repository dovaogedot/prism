/**
 * Address accuracy beyond its format: does this street exist in this city
 * under this postal code? OpenStreetMap's Nominatim answers without an
 * account. When it cannot be reached the shop keeps selling, and the format
 * check alone decides.
 */

import type { ShippingAddress } from "@prism/shared";

/** What a lookup found. `unavailable` means nobody could say. */
export type AddressVerdict = "verified" | "not_found" | "unavailable";

/** Looking an address up. Never rejects. */
export type AddressVerifier = Readonly<{
  verify: (address: ShippingAddress) => Promise<AddressVerdict>;
}>;

/** A verifier whose answer a test chooses, and which records what it was asked. */
export type FakeAddressVerifier = AddressVerifier &
  Readonly<{
    asked: readonly ShippingAddress[];
    answer: (verdict: AddressVerdict) => void;
    /** Forgets what was asked and answers `verified` again. */
    clear: () => void;
  }>;

export const AddressVerifier = {
  TIMEOUT_MS: 5000,

  /**
   * One structured search per check, as Nominatim's usage policy asks. An
   * unknown house number falls back to the street, so a real street with a
   * number OpenStreetMap lacks still verifies.
   */
  nominatim: (baseUrl: string, userAgent: string): AddressVerifier => ({
    verify: async (address) => {
      const query = new URLSearchParams({
        format: "jsonv2",
        limit: "1",
        street: address.line1,
        city: address.city,
        postalcode: address.postalCode,
        countrycodes: address.country.toLowerCase(),
      });

      try {
        const response = await fetch(`${baseUrl}/search?${query}`, {
          headers: { "user-agent": userAgent, accept: "application/json" },
          signal: AbortSignal.timeout(AddressVerifier.TIMEOUT_MS),
        });

        if (!response.ok) return "unavailable";

        const results: unknown = await response.json();
        if (!Array.isArray(results)) return "unavailable";

        return results.length > 0 ? "verified" : "not_found";
      } catch {
        return "unavailable";
      }
    },
  }),

  /** No lookup at all: the format check decides alone. */
  formatOnly: (): AddressVerifier => ({ verify: async () => "unavailable" }),

  /** Answers `verified` until told otherwise. */
  fake: (): FakeAddressVerifier => {
    const asked: ShippingAddress[] = [];
    let verdict: AddressVerdict = "verified";

    return {
      asked,
      answer: (next) => {
        verdict = next;
      },
      clear: () => {
        asked.length = 0;
        verdict = "verified";
      },
      verify: async (address) => {
        asked.push(address);
        return verdict;
      },
    };
  },
} as const;
