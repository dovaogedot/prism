/**
 * REQUIREMENTS_1.md: "The README file contains a clear project overview,
 * entity relationship diagram, setup instructions, and usage guide"
 */

import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8")

describe("the README", () => {
  it("opens with an overview of what the shop is", () => {
    const [title, , overview] = readme.split("\n")

    expect(title).toBe("# Prism")
    expect(overview).toMatch(/business-to-consumer shop/)
  })

  it("holds the entity relationship diagram", () => {
    expect(readme).toMatch(/^## Entity relationship diagram$/m)
    expect(readme).toMatch(/!\[[^\]]+\]\(docs\/erd\.svg\)/)
    expect(existsSync(new URL("../../docs/erd.svg", import.meta.url))).toBe(true)
  })

  it("explains how to set it up and run it", () => {
    expect(readme).toMatch(/^## Running it$/m)
    expect(readme).toMatch(/\.\/start\.sh/)
  })

  it("has a usage guide", () => {
    expect(readme).toMatch(/^## Usage$/m)
  })
})
