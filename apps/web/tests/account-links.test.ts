import { describe, expect, it } from "vitest";
import { AccountLinks } from "../src/app/account-links.ts";

describe("AccountLinks", () => {
  it("lists the admin for staff only", () => {
    expect(AccountLinks.listFor([]).map((link) => link.to)).toEqual(["/account/orders", "/account", "/account/addresses"]);
    expect(AccountLinks.listFor(["support"]).map((link) => link.to)).toContain("/admin");
  });

  it("signs in back to the page it was opened on, query included", () => {
    expect(AccountLinks.signInFrom("/products/lamp?ref=home")).toBe("/login?next=%2Fproducts%2Flamp%3Fref%3Dhome");
  });
});
