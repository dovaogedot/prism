/**
 * REQUIREMENTS_1.md: "An Entity Relationship Diagram (ERD) is provided,
 * clearly showing entities, attributes, relationships, primary keys, foreign
 * keys, cardinality, and modality."
 *
 * The diagram's source, docs/erd.mmd, is held to the schema the migrations
 * build on a real Postgres, and the picture the README shows, docs/erd.svg,
 * to that source.
 */

import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

/** One foreign key column as Postgres holds it. */
type ForeignKey = { child: string; column: string; parent: string; isNullable: boolean; isUnique: boolean }

/** One entity block of the diagram: each attribute with its key markers. */
type Entity = { attributes: Map<string, string[]> }

/** One relationship line: the marker at each end, each as written beside its own entity. */
type Relationship = { left: string; leftMarker: string; rightMarker: string; right: string }

const readDocument = (path: string): string => readFileSync(new URL(`../../docs/${path}`, import.meta.url), "utf8")

const diagram = readDocument("erd.mmd")
const picture = readDocument("erd.svg")

/** Every entity block of the diagram, by name. */
const entities = new Map<string, Entity>(
  [...diagram.matchAll(/^ {2}(\w+) \{\n([\s\S]*?)\n {2}\}/gm)].map(([, name, body]) => [
    String(name),
    {
      attributes: new Map(
        String(body)
          .split("\n")
          .map((line) => /^\s+\S+ (\w+)(?: ([A-Z, ]+?))?(?: "[^"]*")?\s*$/.exec(line))
          .filter((match) => match !== null)
          .map((match) => [String(match[1]), (match[2] ?? "").split(",").map((key) => key.trim())]),
      ),
    },
  ]),
)

/** Every relationship line of the diagram. */
const relationships: Relationship[] = [...diagram.matchAll(/^ {2}(\w+) ([|}][|o])(?:--|\.\.)([|o][|{]) (\w+) : "[^"]+"$/gm)].map(
  ([, left, leftMarker, rightMarker, right]) => ({
    left: String(left),
    leftMarker: String(leftMarker),
    rightMarker: String(rightMarker),
    right: String(right),
  }),
)

/** A relationship as one line of text, so two drawings of it compare as strings. */
const describeRelationship = (line: Relationship): string => `${line.left} ${line.leftMarker}--${line.rightMarker} ${line.right}`

/** How Mermaid names the marker it draws at each end of a line, as the marker reads in the diagram's text. */
const pictureMarkers: Record<string, string> = {
  onlyOneStart: "||",
  zeroOrOneStart: "|o",
  oneOrMoreStart: "}|",
  zeroOrMoreStart: "}o",
  onlyOneEnd: "||",
  zeroOrOneEnd: "o|",
  oneOrMoreEnd: "|{",
  zeroOrMoreEnd: "o{",
}

/** Every relationship the picture draws, read off its lines' ids and end markers. */
const pictureRelationships: Relationship[] = [...picture.matchAll(/<path [^>]*class="[^"]*\brelationshipLine\b[^"]*"[^>]*>/g)].map(
  ([path]) => {
    const [, left, right] = /\bid="[^"]*?id_entity-(\w+)-\d+_entity-(\w+)-\d+_\d+"/.exec(path) ?? []
    const start = /marker-start="url\(#\w*?_er-(\w+)\)"/.exec(path)?.[1] ?? ""
    const end = /marker-end="url\(#\w*?_er-(\w+)\)"/.exec(path)?.[1] ?? ""

    return { left: String(left), leftMarker: pictureMarkers[start] ?? start, rightMarker: pictureMarkers[end] ?? end, right: String(right) }
  },
)

/** The columns of each table, by table. */
let columns: Map<string, string[]>
/** The primary key columns of each table, by table. */
let primaryKeys: Map<string, string[]>
let foreignKeys: ForeignKey[]

const groupByTable = (rows: { table: string; column: string }[]): Map<string, string[]> =>
  new Map([...Map.groupBy(rows, (row) => row.table)].map(([table, entries]) => [table, entries.map((entry) => entry.column).toSorted()]))

/** A marker as it reads on the other side of a line: `}o` on the left is `o{` on the right. */
const mirrorMarker = (marker: string): string =>
  [...marker]
    .toReversed()
    .map((char) => ({ "{": "}", "}": "{" })[char] ?? char)
    .join("")

/** The names of the attributes the diagram marks with `key` in `entity`. */
const listMarked = (entity: Entity, key: string): string[] =>
  [...entity.attributes.entries()]
    .filter(([, keys]) => keys.includes(key))
    .map(([name]) => name)
    .toSorted()

beforeAll(async () => {
  harness = await startHarness()
  const { sql } = harness.database

  columns = groupByTable(
    await sql<{ table: string; column: string }[]>`
      SELECT table_name AS table, column_name AS column FROM information_schema.columns WHERE table_schema = 'public'`,
  )
  primaryKeys = groupByTable(
    await sql<{ table: string; column: string }[]>`
      SELECT c.relname AS table, a.attname AS column
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
      WHERE k.contype = 'p' AND k.connamespace = 'public'::regnamespace`,
  )
  // A key column is unique when an index holds it alone, so a parent row has at most one child.
  foreignKeys = await sql<ForeignKey[]>`
    SELECT child.relname AS child, a.attname AS column, parent.relname AS parent, NOT a.attnotnull AS "isNullable",
      EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = k.conrelid AND i.indisunique AND i.indnkeyatts = 1 AND i.indkey[0] = a.attnum AND i.indpred IS NULL
      ) AS "isUnique"
    FROM pg_constraint k
    JOIN pg_class child ON child.oid = k.conrelid
    JOIN pg_class parent ON parent.oid = k.confrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace`
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

describe("the ERD", () => {
  it("draws every table the schema has as an entity, and no other", () => {
    const pictured = [...new Set([...picture.matchAll(/\bid="[\w-]*?entity-(\w+)-\d+"/g)].map(([, name]) => String(name)))]

    expect([...entities.keys()].toSorted()).toEqual([...columns.keys()].toSorted())
    expect(pictured.toSorted()).toEqual([...columns.keys()].toSorted())
  })

  it("lists every column of each table as an attribute of its entity", () => {
    for (const [table, tableColumns] of columns) {
      expect([...(entities.get(table)?.attributes.keys() ?? [])].toSorted(), table).toEqual(tableColumns)
    }
  })

  it("marks exactly the primary key columns PK and the foreign key columns FK", () => {
    for (const [table, entity] of entities) {
      const tableForeignKeys = foreignKeys.filter((key) => key.child === table).map((key) => key.column)

      expect(listMarked(entity, "PK"), table).toEqual(primaryKeys.get(table) ?? [])
      expect(listMarked(entity, "FK"), table).toEqual(tableForeignKeys.toSorted())
    }
  })

  it("draws one relationship for every foreign key, with the cardinality and modality the schema gives each end", () => {
    // The parent's end says how many parents a row has: exactly one when the key column is required, zero or one when it may be null.
    // The child's end says how many rows a parent has: at most one when the key column is unique, any number otherwise.
    const listDrawnLines = (key: ForeignKey): string[] =>
      relationships.flatMap((line) => {
        if (line.left === key.parent && line.right === key.child) {
          return [`${line.leftMarker}--${line.rightMarker}`]
        }

        if (line.left === key.child && line.right === key.parent) {
          return [`${mirrorMarker(line.rightMarker)}--${mirrorMarker(line.leftMarker)}`]
        }

        return []
      })

    const mismatches = foreignKeys.flatMap((key) => {
      const parentEnd = key.isNullable ? "|o" : "||"
      const childEnds = key.isUnique ? ["o|", "||"] : ["o{", "|{"]
      const drawn = listDrawnLines(key)

      return drawn.some((line) => childEnds.some((childEnd) => line === `${parentEnd}--${childEnd}`))
        ? []
        : [
            `${key.child}.${key.column} -> ${key.parent}: wants ${parentEnd}--${childEnds.join(" or ")}, drawn ${drawn.join(", ") || "nothing"}`,
          ]
    })

    expect(mismatches).toEqual([])
    expect(relationships).toHaveLength(foreignKeys.length)
  })

  it("is pictured in the README with the same relationships and the same end markers as its source", () => {
    expect(pictureRelationships.map(describeRelationship).toSorted()).toEqual(relationships.map(describeRelationship).toSorted())
  })
})
