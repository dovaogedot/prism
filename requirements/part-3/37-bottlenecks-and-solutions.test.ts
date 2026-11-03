/**
 * REQUIREMENTS_3.md: "Student has identified potential bottlenecks and can
 * propose solutions."
 *
 * Checks the README names each bottleneck with its cause and its fix or
 * proposed solution, that the fixes it says were made are in the database
 * the API runs on, and that the figures it quotes come from the stress run's
 * records, which the repository keeps in `loadtest/results`. Explaining them
 * is the student's part.
 */

import { readFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"
import { StressSteps } from "../../loadtest/lib/steps.ts"

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8")
const bottlenecks = readme.slice(readme.indexOf("\n### Bottlenecks\n"), readme.indexOf("\n## Testing\n"))
const results = new URL("../../loadtest/results/", import.meta.url)

/** The rows of the table whose header starts with `header`, each as its trimmed cells. */
const rowsUnder = (header: string): readonly (readonly string[])[] => {
  const lines = bottlenecks.split("\n")
  const start = lines.findIndex((line) => line.startsWith(header))
  const rows: string[][] = []

  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) {
      break
    }

    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    )
  }

  return rows
}

describe("the README's bottlenecks", () => {
  it("name the bottlenecks fixed, each with its cause, its fix and the figures before and after", () => {
    const fixed = rowsUnder("| Bottleneck | Cause | Fix | Without the fix | With it |")

    expect(fixed.map((row) => row[0])).toEqual(["Ratings", "Category pictures", "JIT compilation", "Facet counts"])
    expect(fixed.filter((row) => row.length !== 5 || row.some((cell) => cell.length === 0))).toEqual([])
  })

  it("propose a solution for each bottleneck that binds next", () => {
    const next = rowsUnder("| Bottleneck | Why | Proposed solution |")

    expect(next.length).toBeGreaterThanOrEqual(3)
    expect(next.filter((row) => row.length !== 3 || row.slice(1).some((cell) => cell.length < 10))).toEqual([])
  })
})

describe("the fixes the README says were made", () => {
  let harness: Harness

  beforeAll(async () => {
    harness = await startHarness()
  }, 180_000)

  afterAll(async () => {
    await harness.stop()
  })

  it("keep each product's rating in its own row, counted again by a trigger", async () => {
    expect(
      await harness.database.sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'product' AND column_name IN ('rating_average', 'rating_count') ORDER BY column_name`,
    ).toEqual([{ column_name: "rating_average" }, { column_name: "rating_count" }])
    expect(await harness.database.sql`SELECT tgname FROM pg_trigger WHERE tgname = 'product_review_rating'`).toHaveLength(1)
  })

  it("index the category's products in the order the category picture is found in", async () => {
    expect(await harness.database.sql`SELECT indexname FROM pg_indexes WHERE indexname = 'product_category_shelf_idx'`).toHaveLength(1)
  })

  it("turn JIT compilation off in the API's database sessions", async () => {
    expect(await harness.database.sql`SHOW jit`).toEqual([{ jit: "off" }])
  })
})

describe("the stress run's own records", () => {
  it("put the quick search's suggestions first among Postgres's costliest statements, at the mean the README quotes", () => {
    const [, first = ""] = readFileSync(new URL("queries-stress.csv", results), "utf8").split("\n")
    const [, , mean = ""] = first.split(",")

    // Only the suggestions select a product's slug, name and price unqualified, from the product table alone.
    expect(first).toContain('select ""slug"", ""name"", ""price_cents""')
    expect(bottlenecks).toContain(`the costliest statement, ${Number(mean).toFixed(1)} ms a call over the stress run`)
  })

  it("show the API's peak CPU the README quotes", () => {
    const peak = Math.max(
      ...readFileSync(new URL("stats-stress.csv", results), "utf8")
        .split("\n")
        .filter((line) => line.includes(",prism-load-api-1,"))
        .map((line) => Number.parseFloat(line.split(",")[2] ?? "")),
    )

    const most = Math.max(...StressSteps.TARGETS).toLocaleString("en-US")
    expect(bottlenecks).toContain(`The API reaches ${peak.toFixed(0)}% of its 2 CPUs at ${most} users`)
  })
})
