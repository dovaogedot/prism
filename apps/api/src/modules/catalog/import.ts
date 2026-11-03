/**
 * Bulk import files, read and checked without the database. A CSV file has
 * a header row naming its columns; a JSON file is an array of objects. Every
 * row is checked against the same rules as the admin's product form, and
 * every bad cell becomes an issue naming its row and column, so one pass
 * reports everything wrong with a file.
 */

import { ImportRow, ProductFields, type ImportReport, type Slug } from "@prism/shared"
import { parse } from "csv-parse/sync"
import { z } from "zod"

/** One problem with one cell, or with the file as a whole when its row is 0. */
export type ImportIssue = ImportReport["issues"][number]

/** A well-formed slug a row names: the product's own, or its category's or brand's. */
export type ImportSlug = Readonly<{ row: number; column: "slug" | "category" | "brand"; slug: Slug }>

/**
 * A file, read: the rows that passed every check, the issues of those that
 * did not, and every well-formed slug a row names, whatever else is wrong
 * with the row, so the checks against the database and across rows name
 * them in the same report.
 */
export type ParsedImport = Readonly<{
  rows: readonly Readonly<{ row: number; product: ImportRow }>[]
  slugs: readonly ImportSlug[]
  issues: readonly ImportIssue[]
}>

/** The fields a JSON file's product may have, each left for the shared rules to check. */
const JsonProduct = {
  schema: z.looseObject({
    slug: z.unknown().optional(),
    name: z.unknown().optional(),
    description: z.unknown().optional(),
    priceCents: z.unknown().optional(),
    stock: z.unknown().optional(),
    category: z.unknown().optional(),
    brand: z.unknown().optional(),
    weightGrams: z.unknown().optional(),
    widthMm: z.unknown().optional(),
    heightMm: z.unknown().optional(),
    depthMm: z.unknown().optional(),
    featured: z.unknown().optional(),
    properties: z.unknown().optional(),
  }),
  /** A product's properties: an object of names and their values. */
  properties: z.record(z.string(), z.string()).optional(),
} as const

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
    const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text)
    if (match === null) return undefined

    return Number(match[1]) * 100 + Number((match[2] ?? "0").padEnd(2, "0"))
  },

  /** A whole number of digits only, or `undefined`. */
  wholeOf: (text: string): number | undefined => (/^\d{1,9}$/.test(text) ? Number(text) : undefined),

  /** The CSV column a product field came from, for an issue's column. */
  columnOf: (path: readonly PropertyKey[], properties: readonly string[]): string => {
    const [field, index] = path
    if (field === "properties" && typeof index === "number") return `${ImportFile.PROPERTY_PREFIX}${properties[index] ?? ""}`

    const column = Object.entries(ImportFile.COLUMNS).find(([, name]) => name === field)?.[0]
    return column ?? String(field ?? "")
  },

  /** The columns whose cells hold a slug. */
  SLUG_COLUMNS: ["slug", "category", "brand"] as const,

  /** The slugs `candidate`, row `row` of the file, names in a well-formed cell. */
  slugsOf: (row: number, candidate: Readonly<Record<string, unknown>>): readonly ImportSlug[] =>
    ImportFile.SLUG_COLUMNS.flatMap((column) => {
      const slug = ImportRow.schema.shape[column].safeParse(candidate[column])
      return slug.success ? [{ row, column, slug: slug.data }] : []
    }),

  /** Checks one candidate product against the shared rules, as row `row` of the file. */
  check: (
    row: number,
    candidate: Readonly<Record<string, unknown>>,
    columnOf: (path: readonly PropertyKey[]) => string,
  ): Readonly<{ product?: ImportRow; slugs: readonly ImportSlug[]; issues: readonly ImportIssue[] }> => {
    const slugs = ImportFile.slugsOf(row, candidate)
    const parsed = ImportRow.schema.safeParse(candidate)
    if (parsed.success) return { product: parsed.data, slugs, issues: [] }

    return { slugs, issues: parsed.error.issues.map((issue) => ({ row, column: columnOf(issue.path), message: issue.message })) }
  },

  /** Adds an issue for every product slug that appears in an earlier row, and keeps only the first row of each. */
  withDuplicates: (parsed: ParsedImport): ParsedImport => {
    const firstRow = new Map<Slug, number>()
    const issues: ImportIssue[] = [...parsed.issues]

    for (const named of parsed.slugs) {
      if (named.column !== "slug") continue

      const earlier = firstRow.get(named.slug)

      if (earlier === undefined) {
        firstRow.set(named.slug, named.row)
      } else {
        issues.push({ row: named.row, column: "slug", message: `This slug is already used in row ${earlier}.` })
      }
    }

    return { rows: parsed.rows.filter((entry) => firstRow.get(entry.product.slug) === entry.row), slugs: parsed.slugs, issues }
  },

  /** Too many rows is a problem with the whole file. */
  withinLimit: (count: number): readonly ImportIssue[] =>
    count > ImportFile.MAX_ROWS ? [{ message: `The file has ${count} rows; an import takes at most ${ImportFile.MAX_ROWS}.` }] : [],

  /** Reads a CSV file: a header row, then one product per row. A byte order mark is ignored. */
  parseCsv: (text: string): ParsedImport => {
    let records: string[][]
    try {
      records = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: false })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The file is not valid CSV."
      return { rows: [], slugs: [], issues: [{ message: `The file is not valid CSV: ${message}` }] }
    }

    const [header, ...body] = records
    if (header === undefined) return { rows: [], slugs: [], issues: [{ message: "The file is empty." }] }

    const columns = header.map((name) => name.trim())
    const known = new Set<string>(Object.keys(ImportFile.COLUMNS))
    // Checked before any loop over the columns, so a huge header costs one comparison.
    const maxColumns = known.size + ProductFields.MAX_PROPERTIES
    if (columns.length > maxColumns) {
      return {
        rows: [],
        slugs: [],
        issues: [{ message: `The header has ${columns.length} columns; an import takes at most ${maxColumns}.` }],
      }
    }

    const issues: ImportIssue[] = [...ImportFile.withinLimit(body.length)]
    const positions = new Map<string, number>()
    const missing = new Set<string>()

    // The rows are read past a header problem, so one report names it and every bad cell: a column
    // named twice is read where it first appears, and one it does not know is left out.
    for (const [index, column] of columns.entries()) {
      const isProperty = column.startsWith(ImportFile.PROPERTY_PREFIX) && column.length > ImportFile.PROPERTY_PREFIX.length
      if (!known.has(column) && !isProperty) issues.push({ row: 1, column, message: "This is not a column an import knows." })
      const first = positions.get(column)
      if (first !== undefined) issues.push({ row: 1, column, message: "This column appears twice." })
      positions.set(column, first ?? index)
    }
    for (const column of known) {
      if (column !== "featured" && !positions.has(column)) {
        issues.push({ row: 1, column, message: "This column is missing." })
        missing.add(column)
      }
    }

    const rows: { row: number; product: ImportRow }[] = []
    const slugs: ImportSlug[] = []

    for (const [index, record] of body.entries()) {
      const row = index + 2
      const cell = (column: string): string => {
        const position = positions.get(column)
        return (position === undefined ? "" : (record[position] ?? "")).trim()
      }
      const properties = columns
        .filter((column) => column.startsWith(ImportFile.PROPERTY_PREFIX) && cell(column).length > 0)
        .map((column) => ({ name: column.slice(ImportFile.PROPERTY_PREFIX.length), value: cell(column) }))
      const cellIssues: ImportIssue[] = []

      const number = (column: string, read: (text: string) => number | undefined, message: string): number | undefined => {
        const value = read(cell(column))
        if (value === undefined) cellIssues.push({ row, column, message })
        return value
      }

      const featured = cell("featured")
      if (featured !== "" && featured !== "true" && featured !== "false") {
        cellIssues.push({ row, column: "featured", message: "Write true or false." })
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
        // An empty cell, like a missing column, leaves the product's featuring as it is.
        ...(featured === "" ? {} : { featured: featured === "true" }),
        properties,
      }

      const checked = ImportFile.check(row, candidate, (path) =>
        ImportFile.columnOf(
          path,
          properties.map((property) => property.name),
        ),
      )
      // A cell that could not be read is reported once, by what was wrong with its text; the shared rules report the rest.
      // A missing column is reported once, in the header, rather than as an empty cell in every row.
      const unread = new Set(cellIssues.map((issue) => issue.column))
      issues.push(
        ...cellIssues.filter((issue) => !missing.has(issue.column ?? "")),
        ...checked.issues.filter((issue) => !unread.has(issue.column) && !missing.has(issue.column ?? "")),
      )
      slugs.push(...checked.slugs)
      if (cellIssues.length === 0 && checked.product !== undefined) rows.push({ row, product: checked.product })
    }

    return ImportFile.withDuplicates({ rows, slugs, issues })
  },

  /** Reads a JSON file: an array of products with the fields in camelCase and `properties` as an object. */
  parseJson: (text: string): ParsedImport => {
    let document: unknown
    try {
      document = JSON.parse(text.replace(/^﻿/, ""))
    } catch {
      return { rows: [], slugs: [], issues: [{ message: "The file is not valid JSON." }] }
    }

    if (!Array.isArray(document)) {
      return { rows: [], slugs: [], issues: [{ message: "The file must hold one JSON array of products." }] }
    }

    const issues: ImportIssue[] = [...ImportFile.withinLimit(document.length)]
    if (issues.length > 0) return { rows: [], slugs: [], issues }

    const rows: { row: number; product: ImportRow }[] = []
    const slugs: ImportSlug[] = []

    for (const [index, entry] of document.entries()) {
      const row = index + 1
      const shaped = JsonProduct.schema.safeParse(entry)

      if (!shaped.success) {
        issues.push(...shaped.error.issues.map((issue) => ({ row, column: issue.path.map(String).join("."), message: issue.message })))
        continue
      }

      // A field it does not know and a malformed `properties` are reported beside what the shared rules find in the rest.
      const { properties: given, ...fields } = shaped.data
      const isKnown = (key: string): boolean => Object.hasOwn(JsonProduct.schema.shape, key)
      const unknown = Object.keys(fields).filter((key) => !isKnown(key))
      const properties = JsonProduct.properties.safeParse(given)
      const pairs = Object.entries(properties.data ?? {})
      const checked = ImportFile.check(
        row,
        {
          ...Object.fromEntries(Object.entries(fields).filter(([key]) => isKnown(key))),
          properties: pairs.map(([name, value]) => ({ name, value })),
        },
        (path) =>
          path[0] === "properties" && typeof path[1] === "number" ? `properties.${pairs[path[1]]?.[0] ?? ""}` : path.map(String).join("."),
      )
      const shapeIssues: ImportIssue[] = [
        ...unknown.map((key) => ({ row, column: key, message: "This is not a field an import knows." })),
        ...(properties.error?.issues ?? []).map((issue) => ({
          row,
          column: ["properties", ...issue.path].map(String).join("."),
          message: issue.message,
        })),
      ]
      issues.push(...shapeIssues, ...checked.issues)
      slugs.push(...checked.slugs)
      if (shapeIssues.length === 0 && checked.product !== undefined) rows.push({ row, product: checked.product })
    }

    return ImportFile.withDuplicates({ rows, slugs, issues })
  },

  /**
   * Reads a file by its name or type: JSON for `.json` or `application/json`,
   * CSV otherwise. A file that is not UTF-8 is one issue, so no character
   * of it is replaced on the way in.
   */
  parse: (file: Readonly<{ filename: string; mimetype: string; bytes: Uint8Array }>): ParsedImport => {
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)
    } catch {
      return {
        rows: [],
        slugs: [],
        issues: [{ message: 'The file is not UTF-8 text. Save it as UTF-8, such as Excel\'s "CSV UTF-8", and try again.' }],
      }
    }

    return file.filename.toLowerCase().endsWith(".json") || file.mimetype === "application/json"
      ? ImportFile.parseJson(text)
      : ImportFile.parseCsv(text)
  },
} as const
