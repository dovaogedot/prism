import { describe, expect, it } from "vitest";
import { formatPrice, isCents, type Cents } from "../../src/domain/money.ts";
import { Option } from "../../src/fp/option.ts";

const cents = (value: number): Cents => {
  if (!isCents(value)) throw new Error(`test fixture is not cents: ${value}`);
  return value;
};

describe("isCents", () => {
  it("accepts non-negative safe integers", () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(1999)).toBe(true);
    expect(isCents(Number.MAX_SAFE_INTEGER)).toBe(true);
  });

  it("rejects fractions, which is the entire point of storing cents", () => {
    expect(isCents(19.99)).toBe(false);
    expect(isCents(0.1 + 0.2)).toBe(false);
  });

  it("rejects negatives and non-finite values", () => {
    expect(isCents(-1)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(isCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
  });
});

describe("formatPrice", () => {
  it("renders euros for the default locale", () => {
    // Intl inserts a non-breaking space in some locales; normalize before asserting.
    const formatted = formatPrice(cents(1999)).replace(/ /g, " ");
    expect(formatted).toContain("19.99");
    expect(formatted).toMatch(/€/);
  });

  it("respects the requested locale", () => {
    const german = formatPrice(cents(1999), "de-DE").replace(/ /g, " ");
    expect(german).toContain("19,99");
  });
});
