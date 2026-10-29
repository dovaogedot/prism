/**
 * REQUIREMENTS_2.md: "Automated tests exist for Unit tests (cart
 * functionality, order calculations) and Critical User Flow tests
 * (registration, checkout process)."
 *
 * Its note: "Ask the student to explain and demonstrate the functionality of
 * the tests." The explaining is for the reviewer. The unit tests are run here,
 * since they take a second; the flow tests each start a Postgres, so they
 * are checked for what they drive and that the API's suite runs them.
 */

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (path: string): string => readFileSync(join(root, path), "utf8")

/** The names of the top-level `describe` blocks in a test file. */
const describedIn = (path: string): readonly string[] => [...read(path).matchAll(/^describe\("([^"]+)"/gm)].map((match) => match[1] ?? "")

/** What a vitest run of `files` in `workspace` reports, run in a process of its own. */
const runVitest = (workspace: string, files: readonly string[]) => {
  // A run started from inside this one would otherwise take this run's worker settings.
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")))
  const output = execFileSync(process.execPath, [join(root, "node_modules/vitest/vitest.mjs"), "run", "--reporter=json", ...files], {
    cwd: join(root, workspace),
    env: environment,
    encoding: "utf8",
  })

  return JSON.parse(output.slice(output.indexOf("{"))) as { success: boolean; numPassedTests: number; numFailedTests: number }
}

describe("unit tests", () => {
  const CART = "packages/shared/tests/domain/cart.test.ts"
  const PRICING = "packages/shared/tests/domain/pricing.test.ts"

  it("cover the cart's rules: adding, setting, merging, and what the stock allows", () => {
    expect(read(CART)).toMatch(/from "\.\.\/\.\.\/src\/domain\/cart\.ts"/)
    expect(describedIn(CART)).toEqual(expect.arrayContaining(["Cart.add", "Cart.set", "Cart.merge", "Cart.issues"]))
  })

  it("cover the order's calculations: line totals, the subtotal, shipping and the total", () => {
    expect(read(PRICING)).toMatch(/from "\.\.\/\.\.\/src\/domain\/pricing\.ts"/)
    expect(describedIn(PRICING)).toEqual(
      expect.arrayContaining(["Pricing.lineTotal", "Pricing.subtotal", "Pricing.shipping", "Pricing.totals"]),
    )
  })

  it("are in the unit run of their workspace", () => {
    expect(read("packages/shared/vitest.config.ts")).toMatch(/include: \["tests\/\*\*\/\*\.test\.ts"\]/)
    expect(JSON.parse(read("packages/shared/package.json"))["scripts"]).toMatchObject({ "test:unit": "vitest run" })
  })

  it("run and pass", () => {
    const report = runVitest("packages/shared", ["tests/domain/cart.test.ts", "tests/domain/pricing.test.ts"])

    expect(report.success).toBe(true)
    expect(report.numFailedTests).toBe(0)
    expect(report.numPassedTests).toBeGreaterThanOrEqual(10)
  }, 60_000)
})

describe("critical user flow tests", () => {
  const REGISTRATION = "apps/api/tests/flows/registration.test.ts"
  const GUEST_CHECKOUT = "apps/api/tests/flows/guest-checkout.test.ts"
  const MEMBER_CHECKOUT = "apps/api/tests/flows/member-checkout.test.ts"

  it("exist for registration and for checking out as a guest and as a member", () => {
    for (const path of [REGISTRATION, GUEST_CHECKOUT, MEMBER_CHECKOUT]) {
      expect(existsSync(join(root, path)), path).toBe(true)
    }
  })

  it("register an account through the API and sign in with it", () => {
    const flow = read(REGISTRATION)

    expect(flow).toMatch(/url: "\/api\/v1\/auth\/register"/)
    expect(flow).toMatch(/url: "\/api\/v1\/auth\/login"/)
  })

  it("place an order through the API and pay for it with a signed webhook", () => {
    for (const path of [GUEST_CHECKOUT, MEMBER_CHECKOUT]) {
      const flow = read(path)

      expect(flow, path).toMatch(/Shop\.call\(harness, "POST", "\/orders"|Shop\.placed\(/)
      expect(flow, path).toMatch(/Shop\.succeed\(/)
    }
  })

  it("are a project of the API's suite", () => {
    const config = read("apps/api/vitest.config.ts")

    expect(config).toMatch(/name: "flows",\s*include: \["tests\/flows\/\*\*\/\*\.test\.ts"\]/)
    expect(JSON.parse(read("apps/api/package.json"))["scripts"]).toMatchObject({ test: "vitest run" })
  })
})
