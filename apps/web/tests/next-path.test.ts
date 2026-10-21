import { describe, expect, it } from "vitest";
import { NextPath } from "../src/features/auth/next-path.ts";

describe("where signing in returns to", () => {
  it("keeps a path on this site, with its query", () => {
    expect(NextPath.of("/orders/123?placed=1")).toBe("/orders/123?placed=1");
    expect(NextPath.of("/")).toBe("/");
  });

  it("sends anything that could leave the site to the home page", () => {
    for (const value of [null, "", "orders", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example", "javascript:alert(1)"]) {
      expect(NextPath.of(value), String(value)).toBe("/");
    }
  });

  it("writes the query that names a path", () => {
    expect(NextPath.query("/orders?status=shipped")).toBe("?next=%2Forders%3Fstatus%3Dshipped");
  });
});
