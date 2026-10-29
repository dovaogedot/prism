/**
 * REQUIREMENTS_3.md: "The README file contains complete project overview,
 * entity relationship diagram, performance analysis report, setup
 * instructions, and usage guide"
 *
 * The diagram counts as complete when it names every table the schema
 * declares, both in its source and in the picture the README shows.
 */

import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8")

/** The text of the README's section under `heading`, up to the next heading of the same level or above. */
const sectionOf = (heading: string): string => {
  const level = heading.indexOf(" ")
  const start = readme.indexOf(`\n${heading}\n`)

  if (start === -1) {
    return ""
  }

  const rest = readme.slice(start + heading.length + 2)
  const end = rest.search(new RegExp(`^#{1,${level}} `, "m"))

  return end === -1 ? rest : rest.slice(0, end)
}

describe("the README", () => {
  it("opens with an overview of what the shop is and what it is built from", () => {
    const [title, , overview, , , , stack] = readme.split("\n")

    expect(title).toBe("# Prism")
    expect(overview).toMatch(/business-to-consumer shop/)
    expect(stack).toMatch(/Fastify API.*Postgres.*RabbitMQ.*React/)
  })

  it("shows an entity relationship diagram that names every table of the schema", () => {
    const schema = readFileSync(new URL("../../apps/api/src/db/schema.ts", import.meta.url), "utf8")
    const tables = [...schema.matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((found) => found[1] ?? "")
    const source = readFileSync(new URL("../../docs/erd.mmd", import.meta.url), "utf8")
    const picture = readFileSync(new URL("../../docs/erd.svg", import.meta.url), "utf8")

    expect(sectionOf("## Entity relationship diagram")).toMatch(/!\[[^\]]+\]\(docs\/erd\.svg\)/)
    expect(tables.length).toBeGreaterThan(10)
    expect(tables.filter((table) => !new RegExp(`^  ${table} \\{$`, "m").test(source))).toEqual([])
    expect(tables.filter((table) => !picture.includes(`>${table}<`))).toEqual([])
  })

  it("holds a performance analysis report: how it was measured, the results, and the bottlenecks", () => {
    const performance = sectionOf("## Performance")

    expect(performance).toMatch(/k6/)
    expect(performance).toMatch(/^### Results$/m)
    expect(performance).toMatch(/^### Bottlenecks$/m)
    expect(performance).toMatch(/^\| Run \| Requests \| Requests\/s \| Transactions\/s \| p50 \| p90 \| p95 \| p99 \| Errors/m)
  })

  it("explains how to set it up and run it", () => {
    const setup = sectionOf("## Running it")

    expect(setup).toMatch(/\.\/start\.sh/)
    expect(setup).toMatch(/docker compose up --build --detach/)
    expect(existsSync(new URL("../../start.sh", import.meta.url))).toBe(true)
    expect(existsSync(new URL("../../.env.example", import.meta.url))).toBe(true)
  })

  it("has a usage guide for shoppers and for the admin", () => {
    const usage = sectionOf("## Usage")

    for (const part of ["### Shopping", "### Reviews", "### Cart", "### Checkout", "### Orders", "### Accounts", "### Admin"]) {
      expect(usage, part).toContain(`\n${part}\n`)
    }
  })
})
