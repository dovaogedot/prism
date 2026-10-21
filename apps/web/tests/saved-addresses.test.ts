import type { SavedAddress } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { SavedAddresses } from "../src/features/account/account.ts";

const address = (label: string, isDefault: boolean) =>
  ({
    id: label,
    label,
    fullName: "Mari Maasikas",
    phone: "+37251234567",
    address: { line1: `${label} 1`, city: "Tallinn", postalCode: "10117", country: "EE" },
    isDefault,
  }) as unknown as SavedAddress;

describe("the saved address checkout starts with", () => {
  it("is the default one, wherever it sits in the list", () => {
    expect(SavedAddresses.initial([address("Work", false), address("Home", true), address("Cottage", false)])?.label).toBe("Home");
  });

  it("is none when no address is the default, or there are none", () => {
    expect(SavedAddresses.initial([address("Work", false)])).toBeUndefined();
    expect(SavedAddresses.initial([])).toBeUndefined();
  });
});

describe("an address on one line", () => {
  it("joins the street, the second line when there is one, and the postal code with the city", () => {
    expect(SavedAddresses.oneLine({ line1: "Narva mnt 7", line2: "Flat 3", city: "Tallinn", postalCode: "10117", country: "EE" })).toBe(
      "Narva mnt 7, Flat 3, 10117 Tallinn",
    );
    expect(SavedAddresses.oneLine({ line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" })).toBe("Narva mnt 7, 10117 Tallinn");
  });
});
