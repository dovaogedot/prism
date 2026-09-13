import type { ProductFacets } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { CatalogParams } from "../src/features/catalog/filters.ts";

const params = (query: string) => new URLSearchParams(query);

const facets: ProductFacets = {
  categories: [{ value: "lighting", label: "Lighting", count: 3 }],
  brands: [{ value: "acme", label: "Acme", count: 2 }],
  ratings: [{ value: "4", label: "4 stars & up", count: 1 }],
  price: { minCents: 500, maxCents: 90000 },
  properties: [{ name: "color", buckets: [{ value: "red", label: "red", count: 1 }] }],
};

describe("CatalogParams.set", () => {
  it("sets a value and drops the page", () => {
    expect(CatalogParams.set(params("page=3&q=lamp"), "category", "lighting").toString()).toBe(
      "q=lamp&category=lighting",
    );
  });

  it("removes the key for an empty value", () => {
    expect(CatalogParams.set(params("category=lighting&sort=rating"), "category", "").toString()).toBe(
      "sort=rating",
    );
  });

  it("keeps the page when the page is what changes", () => {
    expect(CatalogParams.set(params("q=lamp"), "page", "2").toString()).toBe("q=lamp&page=2");
  });

  it("leaves the input alone", () => {
    const before = params("q=lamp");
    CatalogParams.set(before, "category", "lighting");
    expect(before.toString()).toBe("q=lamp");
  });
});

describe("CatalogParams.toggle", () => {
  it("adds a value that is absent", () => {
    expect(CatalogParams.toggle(params("brand=acme"), "brand", "globex").toString()).toBe(
      "brand=acme&brand=globex",
    );
  });

  it("removes a value that is present, keeping the others", () => {
    expect(CatalogParams.toggle(params("brand=acme&brand=globex&page=2"), "brand", "acme").toString()).toBe(
      "brand=globex",
    );
  });

  it("works on a property key", () => {
    expect(CatalogParams.toggle(params(""), CatalogParams.propertyKey("color"), "red").toString()).toBe(
      "p.color=red",
    );
  });
});

describe("CatalogParams.has", () => {
  it("finds a value among the repeats", () => {
    expect(CatalogParams.has(params("brand=acme&brand=globex"), "brand", "globex")).toBe(true);
    expect(CatalogParams.has(params("brand=acme"), "brand", "globex")).toBe(false);
  });
});

describe("CatalogParams.isFiltered", () => {
  it("ignores the text, category, sort and paging", () => {
    expect(CatalogParams.isFiltered(params("q=lamp&category=lighting&sort=rating&page=2&perPage=24"))).toBe(false);
  });

  it("counts any other key", () => {
    expect(CatalogParams.isFiltered(params("q=lamp&p.color=red"))).toBe(true);
    expect(CatalogParams.isFiltered(params("rating=4"))).toBe(true);
  });
});

describe("CatalogParams.active", () => {
  it("names each filter from the facets, in URL order, and leaves the rest when one goes", () => {
    const found = CatalogParams.active(params("q=lamp&category=lighting&brand=acme&brand=other&p.color=red&rating=4&page=2"), facets);

    expect(found.map((filter) => filter.label)).toEqual(["Acme", "other", "color: red", "4 stars & up"]);
    expect(found[0]?.next.toString()).toBe("q=lamp&category=lighting&p.color=red&rating=4&brand=other");
  });

  it("makes one filter of the two price bounds, and fills a missing bound from the facets", () => {
    expect(CatalogParams.active(params("priceMin=1000&priceMax=2000"), facets).map((filter) => filter.label)).toEqual(["€10.00 – €20.00"]);

    const [only] = CatalogParams.active(params("priceMax=2000&brand=acme"), facets);
    expect(only?.label).toBe("€5.00 – €20.00");
    expect(only?.next.toString()).toBe("brand=acme");
  });

  it("finds nothing among the text, category, sort and paging", () => {
    expect(CatalogParams.active(params("q=lamp&category=lighting&sort=rating&page=2"), facets)).toEqual([]);
  });
});

describe("CatalogParams.cleared", () => {
  it("keeps the text, category, sort and page size, and drops everything else", () => {
    expect(
      CatalogParams.cleared(params("q=lamp&category=lighting&sort=rating&page=2&perPage=24&brand=acme&p.color=red")).toString(),
    ).toBe("q=lamp&category=lighting&sort=rating&perPage=24");
  });
});
