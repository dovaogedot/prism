import { describe, expect, it } from "vitest";
import { Listing } from "../src/features/catalog/listing.ts";

const params = (query: string) => new URLSearchParams(query);

describe("the listing's view", () => {
  it("is the grid unless the URL asks for the list", () => {
    expect(Listing.view(params(""))).toBe("grid");
    expect(Listing.view(params("view=list"))).toBe("list");
    expect(Listing.view(params("view=sideways"))).toBe("grid");
  });

  it("keeps the list in the URL and leaves the default grid out, keeping everything else", () => {
    expect(Listing.withView(params("brand=acme&page=2"), "list").toString()).toBe("brand=acme&page=2&view=list");
    expect(Listing.withView(params("view=list&brand=acme"), "grid").toString()).toBe("brand=acme");
  });
});

describe("the query the listing asks the API", () => {
  it("drops the view, which only the page reads", () => {
    expect(Listing.apiQuery(params("q=lamp&view=list&page=2"), undefined)).toBe("q=lamp&page=2");
  });

  it("takes a category page's category from its path", () => {
    expect(Listing.apiQuery(params("brand=acme"), "minecraft")).toBe("brand=acme&category=minecraft");
  });
});

describe("the canonical address of a category", () => {
  it("sends /shop?category=x to the category's own page, from its first page", () => {
    expect(Listing.categoryRedirect(params("category=minecraft"))).toBe("/categories/minecraft");
    expect(Listing.categoryRedirect(params("brand=mojang&category=minecraft&page=3&sort=newest"))).toBe(
      "/categories/minecraft?brand=mojang&sort=newest",
    );
  });

  it("leaves /shop alone without a category", () => {
    expect(Listing.categoryRedirect(params("brand=mojang"))).toBeUndefined();
    expect(Listing.categoryRedirect(params("category="))).toBeUndefined();
  });
});
