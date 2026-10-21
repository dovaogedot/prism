import { describe, expect, it } from "vitest";
import { DeliveryDates } from "../src/shared/format/delivery-dates.ts";

describe("delivery dates in words", () => {
  it("names one day, or the first and last day", () => {
    expect(DeliveryDates.format({ from: "2026-10-21", to: "2026-10-21" })).toBe("Wed 21 Oct");
    expect(DeliveryDates.format({ from: "2026-10-21", to: "2026-10-23" })).toBe("Wed 21 Oct to Fri 23 Oct");
  });

  it("ends a sentence with the day or the days between", () => {
    expect(DeliveryDates.phrase({ from: "2026-10-21", to: "2026-10-21" })).toBe("on Wed 21 Oct");
    expect(DeliveryDates.phrase({ from: "2026-10-21", to: "2026-10-23" })).toBe("between Wed 21 Oct and Fri 23 Oct");
  });
});
