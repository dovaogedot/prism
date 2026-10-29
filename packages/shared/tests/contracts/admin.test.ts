import { describe, expect, it } from "vitest";
import { AdminProductQuery } from "../../src/contracts/admin.ts";

describe("AdminProductQuery", () => {
  it("reads a sort named by its field alone as that field's first order", () => {
    const sortOf = (sort?: string) => AdminProductQuery.schema.parse(sort === undefined ? {} : { sort }).sort;

    expect([sortOf("name"), sortOf("stock"), sortOf("price"), sortOf("price_desc"), sortOf()]).toEqual([
      "name_asc",
      "stock_asc",
      "price_asc",
      "price_desc",
      "name_asc",
    ]);
    expect(AdminProductQuery.schema.safeParse({ sort: "rating" }).success).toBe(false);
  });
});
