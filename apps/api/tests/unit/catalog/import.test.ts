import { describe, expect, it } from "vitest";
import { ImportFile } from "../../../src/modules/catalog/import.ts";

const HEADER = "slug,name,description,price,stock,category,brand,weight_g,width_mm,height_mm,depth_mm,featured";

/** One CSV data row with `overrides` in place of the defaults, in header order. */
const row = (overrides: Readonly<Record<string, string>> = {}): string => {
  const cells: Record<string, string> = {
    slug: "desk-lamp",
    name: "Desk Lamp",
    description: "A lamp.",
    price: "25.00",
    stock: "10",
    category: "lamps",
    brand: "acme",
    weight_g: "900",
    width_mm: "200",
    height_mm: "400",
    depth_mm: "200",
    featured: "false",
    ...overrides,
  };
  return HEADER.split(",").map((column) => cells[column] ?? "").join(",");
};

describe("ImportFile.centsOf", () => {
  it.each([
    ["12.9", 1290],
    ["12.90", 1290],
    ["12", 1200],
    ["0.05", 5],
  ])("reads %s as %i cents", (text, cents) => {
    expect(ImportFile.centsOf(text)).toBe(cents);
  });

  it.each(["12.901", "-1", "1,20", "", "12.", ".5", "1e3", "abc"])("refuses %j", (text) => {
    expect(ImportFile.centsOf(text)).toBeUndefined();
  });
});

describe("ImportFile.parseCsv", () => {
  it("reads a row with its properties, leaving out empty property cells", () => {
    const parsed = ImportFile.parseCsv(
      `${HEADER},property:Color,property:Material\n${row()},Brass,\n`,
    );

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        row: 2,
        product: {
          slug: "desk-lamp",
          name: "Desk Lamp",
          description: "A lamp.",
          priceCents: 2500,
          stock: 10,
          category: "lamps",
          brand: "acme",
          weightGrams: 900,
          widthMm: 200,
          heightMm: 400,
          depthMm: 200,
          featured: false,
          properties: [{ name: "Color", value: "Brass" }],
        },
      },
    ]);
  });

  it("reads quoted fields that hold commas and line breaks, and ignores a byte order mark", () => {
    const parsed = ImportFile.parseCsv(`﻿${HEADER}\n${row({ description: '"Bright, warm\nand steady"' })}\n`);

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]?.product.description).toBe("Bright, warm\nand steady");
  });

  it("names the row and column of each price it cannot read", () => {
    const parsed = ImportFile.parseCsv(
      [HEADER, row({ slug: "a", price: "12.901" }), row({ slug: "b", price: "-1" }), row({ slug: "c", price: '"1,20"' })].join("\n"),
    );

    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map((issue) => [issue.row, issue.column])).toEqual([
      [2, "price"],
      [3, "price"],
      [4, "price"],
    ]);
  });

  it("refuses a column it does not know, and a missing one", () => {
    const parsed = ImportFile.parseCsv(`${HEADER.replace(",stock", "")},colour\n`);

    expect(parsed.issues).toEqual([
      { row: 1, column: "colour", message: "This is not a column an import knows." },
      { row: 1, column: "stock", message: "This column is missing." },
    ]);
  });

  it("refuses a slug that appears twice in one file, naming both rows", () => {
    const parsed = ImportFile.parseCsv([HEADER, row(), row({ name: "Another lamp" })].join("\n"));

    expect(parsed.rows).toHaveLength(1);
    expect(parsed.issues).toEqual([{ row: 3, column: "slug", message: "This slug is already used in row 2." }]);
  });

  it("checks every cell against the product rules, naming the column", () => {
    const parsed = ImportFile.parseCsv([HEADER, row({ name: "", stock: "lots", featured: "yes" })].join("\n"));

    expect(parsed.issues.map((issue) => issue.column).sort()).toEqual(["featured", "stock"]);
  });

  it("refuses more than 5,000 rows", () => {
    const rows = Array.from({ length: 5001 }, (_, index) => row({ slug: `item-${index}` }));

    expect(ImportFile.parseCsv([HEADER, ...rows].join("\n")).issues).toEqual([
      { row: 0, column: "", message: "The file has 5001 rows; an import takes at most 5000." },
    ]);
  });
});

describe("ImportFile.parseJson", () => {
  const product = {
    slug: "desk-lamp",
    name: "Desk Lamp",
    description: "A lamp.",
    priceCents: 2500,
    stock: 10,
    category: "lamps",
    brand: "acme",
    weightGrams: 900,
    widthMm: 200,
    heightMm: 400,
    depthMm: 200,
  };

  it("reads an array of products with properties as an object", () => {
    const parsed = ImportFile.parseJson(JSON.stringify([{ ...product, featured: true, properties: { Color: "Brass" } }]));

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      row: 1,
      product: { slug: "desk-lamp", featured: true, properties: [{ name: "Color", value: "Brass" }] },
    });
  });

  it("refuses a field it does not know, and anything but an array", () => {
    expect(ImportFile.parseJson(JSON.stringify([{ ...product, price: 25 }])).issues).toEqual([
      { row: 1, column: "price", message: "This is not a field an import knows." },
    ]);
    expect(ImportFile.parseJson(JSON.stringify(product)).issues).toEqual([
      { row: 0, column: "", message: "The file must hold one JSON array of products." },
    ]);
  });
});
