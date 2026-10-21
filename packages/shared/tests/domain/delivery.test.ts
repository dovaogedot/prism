import { describe, expect, it } from "vitest";
import { Delivery } from "../../src/domain/delivery.ts";

const standard = { minDays: 2, maxDays: 4 };

describe("Delivery.estimate", () => {
  it("counts business days after a Monday", () => {
    // Monday 19 October 2026, noon in Tallinn.
    expect(Delivery.estimate(new Date("2026-10-19T09:00:00Z"), standard)).toEqual({ from: "2026-10-21", to: "2026-10-23" });
  });

  it("skips the weekend after a Friday", () => {
    expect(Delivery.estimate(new Date("2026-10-23T09:00:00Z"), standard)).toEqual({ from: "2026-10-27", to: "2026-10-29" });
  });

  it("starts counting on Monday after a Sunday", () => {
    expect(Delivery.estimate(new Date("2026-10-25T09:00:00Z"), standard)).toEqual({ from: "2026-10-27", to: "2026-10-29" });
  });

  it("gives one day when the minimum equals the maximum", () => {
    expect(Delivery.estimate(new Date("2026-10-19T09:00:00Z"), { minDays: 1, maxDays: 1 })).toEqual({
      from: "2026-10-20",
      to: "2026-10-20",
    });
  });

  it("counts from the order's day in Tallinn, not in UTC", () => {
    // 23:30 UTC on Friday is already Saturday in Tallinn.
    expect(Delivery.dayOf(new Date("2026-10-23T23:30:00Z"))).toBe("2026-10-24");
    expect(Delivery.estimate(new Date("2026-10-23T23:30:00Z"), { minDays: 1, maxDays: 1 })).toEqual({
      from: "2026-10-26",
      to: "2026-10-26",
    });
  });
});
