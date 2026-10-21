import { describe, expect, it } from "vitest";
import { Permission, StaffRole } from "../../src/contracts/staff.ts";

describe("Permission", () => {
  it("lists every permission that has a label and a grant", () => {
    expect([...Permission.NAMES].sort()).toEqual(Object.keys(Permission.label).sort());
    expect([...Permission.NAMES].sort()).toEqual(Object.keys(Permission.grantedTo).sort());
  });

  it("grants an admin everything", () => {
    expect(Permission.of(["admin"])).toEqual(Permission.NAMES);
  });

  it("grants each other role only its own job", () => {
    expect(Permission.of(["moderator"])).toEqual(["reviews.moderate"]);
    expect(Permission.of(["content_manager"])).toEqual(["catalog.manage", "catalog.import"]);
    expect(Permission.of(["delivery_manager"])).toEqual(["orders.view", "orders.fulfill", "delivery.manage"]);
    expect(Permission.of(["support"])).toEqual(["orders.view", "orders.refund", "customers.view"]);
  });

  it("grants a customer nothing", () => {
    expect(Permission.of([])).toEqual([]);
    for (const permission of Permission.NAMES) expect(Permission.can([], permission)).toBe(false);
  });

  it("adds up the permissions of several roles", () => {
    expect(Permission.of(["moderator", "content_manager"])).toEqual(["reviews.moderate", "catalog.manage", "catalog.import"]);
  });

  it("keeps staff management and the audit log for admins", () => {
    for (const role of StaffRole.NAMES.filter((name) => name !== "admin")) {
      expect(Permission.can([role], "staff.manage"), role).toBe(false);
      expect(Permission.can([role], "audit.view"), role).toBe(false);
    }
  });
});
