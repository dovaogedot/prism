/**
 * REQUIREMENTS_1.md: "Automated tests exist for Unit, API integration, and
 * Security tests covering authentication and product catalog
 * functionality. Ask the student to explain and demonstrate the
 * functionality of the tests."
 *
 * The checks find the suites and what they cover; the explanation and the
 * demonstration are the student's.
 */

import { globSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import apiTestConfig from "../../apps/api/vitest.config.ts"

const apiDirectory = new URL("../../apps/api/", import.meta.url)

/** One project of the API's test configuration, as far as these checks read it. */
type Project = { test: { name: string; include: string[] } }

const projects = (apiTestConfig.test?.projects ?? []) as Project[]

/** The text of every test file the project named `name` runs, by path. */
const readSuite = (name: string): Map<string, string> => {
  const project = projects.find((entry) => entry.test.name === name)
  if (project === undefined) {
    throw new Error(`The API's test configuration has no ${name} project.`)
  }

  return new Map(
    project.test.include
      .flatMap((pattern) => globSync(pattern, { cwd: apiDirectory }))
      .map((path) => [path, readFileSync(new URL(path, apiDirectory), "utf8")]),
  )
}

/** What a file has to touch to count as a test of each topic: the routes it calls or the modules it imports. */
const topics = {
  authentication: /\/api\/v1\/auth\/|src\/modules\/auth\/|src\/platform\/tokens\.ts/,
  catalog: /\/api\/v1\/(admin\/)?products\b|src\/modules\/catalog\//,
} as const

/** The files of `files` that test `topic`, each holding at least one test case. */
const filterByTopic = (files: Map<string, string>, topic: RegExp): string[] =>
  [...files].filter(([, text]) => topic.test(text) && /^\s*(it|test)(\.each\([\s\S]*?\))?\(/m.test(text)).map(([path]) => path)

describe("the API's automated tests", () => {
  it.each(["unit", "integration", "security"])("have a %s suite with tests of authentication and of the product catalog", (name) => {
    const files = readSuite(name)

    expect(filterByTopic(files, topics.authentication), `${name} tests of authentication`).not.toEqual([])
    expect(filterByTopic(files, topics.catalog), `${name} tests of the catalog`).not.toEqual([])
  })

  it("run on every push: npm test runs every suite, and CI runs it before a deploy can start", () => {
    const rootScripts = (
      JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }
    ).scripts
    const apiScripts = (JSON.parse(readFileSync(new URL("package.json", apiDirectory), "utf8")) as { scripts: Record<string, string> })
      .scripts
    const workflow = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8")

    expect(rootScripts["test"]).toMatch(/npm run test --workspaces/)
    expect(apiScripts["test"]).toBe("vitest run")
    expect(workflow).toMatch(/^on:.*\n\s+push:/m)
    expect(workflow).toMatch(/^ {6}- run: npm test\b/m)
    expect(workflow).toMatch(/^ {4}needs: \[verify\b/m)
  })
})
