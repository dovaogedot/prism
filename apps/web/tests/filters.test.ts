import { describe, expect, it } from "vitest";
import { CatalogParams } from "../src/features/catalog/filters.ts";

const params = (query: string) => new URLSearchParams(query);

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
  it("ignores the text, sort and paging", () => {
    expect(CatalogParams.isFiltered(params("q=lamp&sort=rating&page=2&perPage=24"))).toBe(false);
  });

  it("counts any other key", () => {
    expect(CatalogParams.isFiltered(params("q=lamp&p.color=red"))).toBe(true);
    expect(CatalogParams.isFiltered(params("rating=4"))).toBe(true);
  });
});

describe("CatalogParams.cleared", () => {
  it("keeps the text, sort and page size, and drops everything else", () => {
    expect(
      CatalogParams.cleared(params("q=lamp&sort=rating&page=2&perPage=24&brand=acme&p.color=red")).toString(),
    ).toBe("q=lamp&sort=rating&perPage=24");
  });
});
