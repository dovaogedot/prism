/**
 * REQUIREMENTS_3.md: "Automated tests exist for Unit, API integration, User
 * flow and Security tests.
 *
 *   Ask the student to explain and demonstrate the functionality of the
 *   tests."
 *
 * Checks that each suite exists, holds tests, and is what the test commands
 * run, along with the topics the task names for it. Explaining and
 * demonstrating the tests is the student's part.
 */

import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = new URL("../../", import.meta.url).pathname

/** The test files under `directory`, recursively, as paths from the repository root. */
const testFilesUnder = (directory: string): readonly string[] =>
  readdirSync(join(root, directory), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.(test|spec)\.ts$/.test(file))
    .map((file) => join(directory, file))

/** How many tests `file` declares. */
const testsIn = (file: string): number => readFileSync(join(root, file), "utf8").match(/^\s*(it|test)(\.each)?\(/gm)?.length ?? 0

const apiProjects = readFileSync(join(root, "apps/api/vitest.config.ts"), "utf8")

describe.each([
  ["Unit", ["apps/api/tests/unit", "packages/shared/tests", "apps/web/tests"], 'name: "unit"'],
  ["API integration", ["apps/api/tests/integration"], 'name: "integration"'],
  ["User flow", ["apps/api/tests/flows"], 'name: "flows"'],
  ["Security", ["apps/api/tests/security"], 'name: "security"'],
])("the %s suite", (_suite, directories, project) => {
  it("has test files, each of which declares tests", () => {
    const files = directories.flatMap(testFilesUnder)

    expect(files.length).toBeGreaterThan(0)
    expect(files.filter((file) => testsIn(file) === 0)).toEqual([])
  })

  it("is a project the API's test command runs", () => {
    expect(apiProjects).toContain(project)
  })
})

describe("the browser suite of user flows", () => {
  it("walks pages and journeys in a real browser", () => {
    const files = testFilesUnder("apps/e2e/tests")

    expect(files).toEqual(expect.arrayContaining(["apps/e2e/tests/journeys.spec.ts", "apps/e2e/tests/admin.spec.ts"]))
    expect(files.filter((file) => testsIn(file) === 0)).toEqual([])
  })
})

describe("the topics the task names", () => {
  it.each([
    ["JWT token handling", "apps/api/tests/unit/platform/tokens.test.ts", /describe\("access token expiration"/],
    ["cart functionality", "packages/shared/tests/domain/cart.test.ts", /describe\("Cart\.add"/],
    ["order summary calculations", "packages/shared/tests/domain/pricing.test.ts", /describe\("Pricing\.totals"/],
    ["user input validation", "packages/shared/tests/contracts/checkout.test.ts", /describe\("ShippingAddress"/],
    ["product search", "apps/api/tests/flows/product-search.test.ts", /\/products\?/],
    ["rate limiting", "apps/api/tests/security/security.test.ts", /describe\("rate limiting"/],
  ])("covers %s", (_topic, file, marker) => {
    expect(readFileSync(join(root, file), "utf8")).toMatch(marker)
    expect(testsIn(file)).toBeGreaterThan(0)
  })
})

describe("the test commands", () => {
  it("run every workspace's suites, in a container that needs only Docker", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }

    expect(manifest.scripts["test"]).toMatch(/npm run test --workspaces/)
    expect(readFileSync(join(root, "Dockerfile.test"), "utf8")).toMatch(/^CMD \["npm", "test"\]$/m)
  })
})
