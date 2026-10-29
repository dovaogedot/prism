import { describe, expect, it } from "vitest";
import { DateFilter } from "../src/shared/hooks/use-date-filter.ts";

describe("DateFilter.isCommittable", () => {
  it("filters by a whole date, and clears on an empty field", () => {
    expect(DateFilter.isCommittable("2026-10-29", {})).toBe(true);
    expect(DateFilter.isCommittable("", {})).toBe(true);
  });

  it("waits while a year is still being typed", () => {
    for (const typed of ["0002-10-29", "0020-10-29", "0202-10-29"]) expect(DateFilter.isCommittable(typed, {}), typed).toBe(false);
  });

  it("keeps a start before the end and an end after the start", () => {
    expect(DateFilter.isCommittable("2026-11-01", { max: "2026-10-31" })).toBe(false);
    expect(DateFilter.isCommittable("2026-10-01", { min: "2026-10-02" })).toBe(false);
    expect(DateFilter.isCommittable("2026-10-02", { min: "2026-10-02", max: "2026-10-02" })).toBe(true);
  });
});
