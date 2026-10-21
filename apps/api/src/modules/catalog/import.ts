/**
 * Bulk import files, read and checked without the database. A CSV file has
 * a header row naming its columns; a JSON file is an array of objects. Every
 * row is checked against the same rules as the admin's product form, and
 * every bad cell becomes an issue naming its row and column, so one pass
 * reports everything wrong with a file.
 */

import { ImportRow, type ImportReport } from "@prism/shared";
import { parse } from "csv-parse/sync";
import { z } from "zod";

/** One problem with one cell, or with the file as a whole when its row is 0. */
export type ImportIssue = ImportReport["issues"][number];

/** A file, read: the rows that passed every check, and the issues of those that did not. */
export type ParsedImport = Readonly<{ rows: readonly Readonly<{ row: number; product: ImportRow }>[]; issues: readonly ImportIssue[] }>;

/** The shape a JSON file's product is checked against before the shared rules. */
const JsonProduct = {
  schema: z
    .object({
      slug: z.unknown(),
      name: z.unknown(),
      description: z.unknown(),
      priceCents: z.unknown(),
      stock: z.unknown(),
      category: z.unknown(),
      brand: z.unknown(),
      weightGrams: z.unknown(),
      widthMm: z.unknown(),
      heightMm: z.unknown(),
      depthMm: z.unknown(),
      featured: z.unknown().optional(),
      properties: z.record(z.string(), z.string()).optional(),
    })
    .strict(),
} as const;

export const ImportFile = {
  MAX_ROWS: 5000,
  MAX_BYTES: 2 * 1024 * 1024,

  /** The columns a CSV file must have, each named once, and the product field each fills. */
  COLUMNS: {
    slug: "slug",
    name: "name",
    description: "description",
    price: "priceCents",
    stock: "stock",
    category: "category",
    brand: "brand",
    weight_g: "weightGrams",
    width_mm: "widthMm",
    height_mm: "heightMm",
    depth_mm: "depthMm",
    featured: "featured",
  } as const,

  /** A CSV column that starts with this holds one named property. */
  PROPERTY_PREFIX: "property:",

  /** Euros with at most two decimals, such as `12.9` or `12.90`, as whole cents; `undefined` for anything else. */
  centsOf: (text: string): number | undefined => {
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
    if (match === null) return undefined;

    return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"));
  },

  /** A whole number of digits only, or `undefined`. */
  wholeOf: (text: string): number | undefined => (/^\d{1,9}$/.test(text) ? Number(text) : undefined),

  /** The CSV column a product field came from, for an issue's column. */
  columnOf: (path: readonly PropertyKey[], properties: readonly string[]): string => {
    const [field, index] = path;
    if (field === "properties" && typeof index === "number") return `${ImportFile.PROPERTY_PREFIX}${properties[index] ?? ""}`;

    const column = Object.entries(ImportFile.COLUMNS).find(([, name]) => name === field)?.[0];
    return column ?? String(field ?? "");
  },

  /** Checks one candidate product against the shared rules, as row `row` of the file. */
  check: (
    row: number,
    candidate: Readonly<Record<string, unknown>>,
    columnOf: (path: readonly PropertyKey[]) => string,
  ): Readonly<{ product?: ImportRow; issues: readonly ImportIssue[] }> => {
    const parsed = ImportRow.schema.safeParse(candidate);
    if (parsed.success) return { product: parsed.data, issues: [] };

    return { issues: parsed.error.issues.map((issue) => ({ row, column: columnOf(issue.path), message: issue.message })) };
  },

  /** Adds an issue for every slug that appears earlier in the file. */
  withDuplicates: (parsed: ParsedImport): ParsedImport => {
    const firstRow = new Map<string, number>();
    const issues: ImportIssue[] = [...parsed.issues];
    const rows: { row: number; product: ImportRow }[] = [];

    for (const entry of parsed.rows) {
      const earlier = firstRow.get(entry.product.slug);
      if (earlier === undefined) {
        firstRow.set(entry.product.slug, entry.row);
        rows.push(entry);
      } else {
        issues.push({ row: entry.row, column: "slug", message: `This slug is already used in row ${earlier}.` });
      }
    }

    return { rows, issues };
  },

  /** Too many rows is a problem with the whole file. */
  withinLimit: (count: number): readonly ImportIssue[] =>
    count > ImportFile.MAX_ROWS
      ? [{ row: 0, column: "", message: `The file has ${count} rows; an import takes at most ${ImportFile.MAX_ROWS}.` }]
      : [],

  /** Reads a CSV file: a header row, then one product per row. A byte order mark is ignored. */
  parseCsv: (text: string): ParsedImport => {
    let records: string[][];
    try {
      records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: false });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The file is not valid CSV.";
      return { rows: [], issues: [{ row: 0, column: "", message: `The file is not valid CSV: ${message}` }] };
    }

    const [header, ...body] = records;
    if (header === undefined) return { rows: [], issues: [{ row: 0, column: "", message: "The file is empty." }] };

    const columns = header.map((name) => name.trim());
    const issues: ImportIssue[] = [...ImportFile.withinLimit(body.length)];
    const known = new Set<string>(Object.keys(ImportFile.COLUMNS));

    for (const [index, column] of columns.entries()) {
      const isProperty = column.startsWith(ImportFile.PROPERTY_PREFIX) && column.length > ImportFile.PROPERTY_PREFIX.length;
      if (!known.has(column) && !isProperty) issues.push({ row: 1, column, message: "This is not a column an import knows." });
      if (columns.indexOf(column) !== index) issues.push({ row: 1, column, message: "This column appears twice." });
    }
    for (const column of Object.keys(ImportFile.COLUMNS)) {
      if (column !== "featured" && !columns.includes(column)) issues.push({ row: 1, column, message: "This column is missing." });
    }
    if (issues.length > 0) return { rows: [], issues };

    const rows: { row: number; product: ImportRow }[] = [];

    for (const [index, record] of body.entries()) {
      const row = index + 2;
      const cell = (column: string): string => (record[columns.indexOf(column)] ?? "").trim();
      const properties = columns
        .filter((column) => column.startsWith(ImportFile.PROPERTY_PREFIX) && cell(column).length > 0)
        .map((column) => ({ name: column.slice(ImportFile.PROPERTY_PREFIX.length), value: cell(column) }));
      const cellIssues: ImportIssue[] = [];

      const number = (column: string, read: (text: string) => number | undefined, message: string): number | undefined => {
        const value = read(cell(column));
        if (value === undefined) cellIssues.push({ row, column, message });
        return value;
      };

      const featured = cell("featured");
      if (featured !== "" && featured !== "true" && featured !== "false") {
        cellIssues.push({ row, column: "featured", message: "Write true or false." });
      }

      const candidate = {
        slug: cell("slug"),
        name: cell("name"),
        description: cell("description"),
        priceCents: number("price", ImportFile.centsOf, "Write the price in euros with at most two decimals, such as 12.90."),
        stock: number("stock", ImportFile.wholeOf, "Write a whole number."),
        category: cell("category"),
        brand: cell("brand"),
        weightGrams: number("weight_g", ImportFile.wholeOf, "Write a whole number of grams."),
        widthMm: number("width_mm", ImportFile.wholeOf, "Write a whole number of millimeters."),
        heightMm: number("height_mm", ImportFile.wholeOf, "Write a whole number of millimeters."),
        depthMm: number("depth_mm", ImportFile.wholeOf, "Write a whole number of millimeters."),
        featured: featured === "true",
        properties,
      };

      if (cellIssues.length > 0) {
        issues.push(...cellIssues);
        continue;
      }

      const checked = ImportFile.check(row, candidate, (path) =>
        ImportFile.columnOf(
          path,
          properties.map((property) => property.name),
        ),
      );
      issues.push(...checked.issues);
      if (checked.product !== undefined) rows.push({ row, product: checked.product });
    }

    return ImportFile.withDuplicates({ rows, issues });
  },

  /** Reads a JSON file: an array of products with the fields in camelCase and `properties` as an object. */
  parseJson: (text: string): ParsedImport => {
    let document: unknown;
    try {
      document = JSON.parse(text.replace(/^﻿/, ""));
    } catch {
      return { rows: [], issues: [{ row: 0, column: "", message: "The file is not valid JSON." }] };
    }

    if (!Array.isArray(document)) {
      return { rows: [], issues: [{ row: 0, column: "", message: "The file must hold one JSON array of products." }] };
    }

    const issues: ImportIssue[] = [...ImportFile.withinLimit(document.length)];
    if (issues.length > 0) return { rows: [], issues };

    const rows: { row: number; product: ImportRow }[] = [];

    for (const [index, entry] of document.entries()) {
      const row = index + 1;
      const shaped = JsonProduct.schema.safeParse(entry);

      if (!shaped.success) {
        for (const issue of shaped.error.issues) {
          const keys = "keys" in issue && Array.isArray(issue.keys) ? issue.keys.map(String) : [];
          if (keys.length > 0) {
            for (const key of keys) issues.push({ row, column: key, message: "This is not a field an import knows." });
          } else {
            issues.push({ row, column: issue.path.map(String).join("."), message: issue.message });
          }
        }
        continue;
      }

      const names = Object.keys(shaped.data.properties ?? {});
      const checked = ImportFile.check(
        row,
        {
          ...shaped.data,
          featured: shaped.data.featured ?? false,
          properties: Object.entries(shaped.data.properties ?? {}).map(([name, value]) => ({ name, value })),
        },
        (path) => (path[0] === "properties" && typeof path[1] === "number" ? `properties.${names[path[1]] ?? ""}` : path.map(String).join(".")),
      );
      issues.push(...checked.issues);
      if (checked.product !== undefined) rows.push({ row, product: checked.product });
    }

    return ImportFile.withDuplicates({ rows, issues });
  },

  /** Reads a file by its name or type: JSON for `.json` or `application/json`, CSV otherwise. */
  parse: (file: Readonly<{ filename: string; mimetype: string; text: string }>): ParsedImport =>
    file.filename.toLowerCase().endsWith(".json") || file.mimetype === "application/json"
      ? ImportFile.parseJson(file.text)
      : ImportFile.parseCsv(file.text),
} as const;
