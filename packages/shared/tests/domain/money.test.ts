import { describe, expect, it } from "vitest";
import { formatAmount, formatPrice, isCents, parseCents, type Cents } from "../../src/domain/money.ts";
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

describe("parseCents", () => {
  it("lifts valid amounts into the brand", () => {
    expect(parseCents(1999)).toEqual(Option.some(1999));
  });

  it("rejects invalid amounts as absence", () => {
    expect(parseCents(-1)).toEqual(Option.none);
    expect(parseCents(19.99)).toEqual(Option.none);
  });
});

describe("formatAmount", () => {
  it("always shows two decimal places", () => {
    expect(formatAmount(cents(1999))).toBe("19.99");
    expect(formatAmount(cents(2000))).toBe("20.00");
    expect(formatAmount(cents(5))).toBe("0.05");
    expect(formatAmount(cents(0))).toBe("0.00");
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
