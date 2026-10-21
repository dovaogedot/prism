import { describe, expect, it } from "vitest";
import { Cents, Euros, Slugs } from "../src/features/admin/forms.ts";

describe("prices typed in euros", () => {
  it("become whole cents, with a dot or a comma, without floating point", () => {
    expect(Euros.schema.parse("12.50")).toBe(1250);
    expect(Euros.schema.parse("12,5")).toBe(1250);
    expect(Euros.schema.parse("0.29")).toBe(29);
    expect(Euros.schema.parse(" 1999 ")).toBe(199_900);
    expect(Euros.schema.parse("1.10")).toBe(110);
  });

  it("refuse anything but euros and cents", () => {
    for (const text of ["", "12.505", "-1", "1e3", "12.5.0", "€12"]) expect(Euros.schema.safeParse(text).success, text).toBe(false);
  });

  it("let an optional amount stay empty", () => {
    expect(Euros.optional.parse("")).toBeUndefined();
    expect(Euros.optional.parse("50")).toBe(5000);
  });

  it("are shown back as staff type them", () => {
    expect(Cents.toEuros(1250)).toBe("12.50");
    expect(Cents.toEuros(5)).toBe("0.05");
    expect(Cents.toEuros(100_000)).toBe("1000.00");
  });
});

describe("a slug made from a name", () => {
  it("joins lowercase words with dashes and drops accents and punctuation", () => {
    expect(Slugs.fromName("Diamond Sword")).toBe("diamond-sword");
    expect(Slugs.fromName("  Ace of Spades (Card)! ")).toBe("ace-of-spades-card");
    expect(Slugs.fromName("Crème brûlée")).toBe("creme-brulee");
  });

  it("never ends on a dash when cut to 120 characters", () => {
    const slug = Slugs.fromName(`${"a".repeat(119)} b`);

    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
  });
});
