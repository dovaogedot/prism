/**
 * REQUIREMENTS_1.md: "User input validation is implemented on both client and
 * server sides for authentication forms."
 *
 * The client side is checked through the schemas the sign-in and
 * registration forms resolve with, which run in the browser on submit.
 */

import { readFileSync } from "node:fs"
import { LoginInput, RegisterForm } from "@prism/shared"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { jsonOf, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

/** One field's complaint, as the form shows it under the field and the API lists it. */
type Issue = { path: string; message: string }

/** The first complaint about each field a schema refuses in `input`, keyed by the field. */
const listClientIssues = (schema: typeof LoginInput.schema | typeof RegisterForm.schema, input: object): Record<string, string> => {
  const parsed = schema.safeParse(input)
  if (parsed.success) {
    throw new Error("The form's schema accepted the input.")
  }

  return Object.fromEntries(parsed.error.issues.toReversed().map((issue) => [issue.path.join("."), issue.message]))
}

/** The first complaint about each field the API refuses in `payload`, keyed by the field; empty when it took the body. */
const listServerIssues = async (url: string, payload: object): Promise<Record<string, string>> => {
  const response = await harness.app.inject({ method: "POST", url: `/api/v1${url}`, payload })
  expect(response.statusCode).toBe(422)

  const issues = (jsonOf(response)["error"] as { issues: Issue[] }).issues

  return Object.fromEntries(issues.toReversed().map((issue) => [issue.path, issue.message]))
}

const readFormSource = (page: string): string =>
  readFileSync(new URL(`../../apps/web/src/features/auth/pages/${page}`, import.meta.url), "utf8")

/** What the registration form sends; the repeated password stays in the browser. */
const badRegistrationBody = { email: "not an address", password: "short", captchaToken: "" }
const badRegistration = { ...badRegistrationBody, confirmPassword: badRegistrationBody.password }
const badSignIn = { email: "not an address", password: "" }

describe("the client", () => {
  it("checks the sign-in form with the sign-in schema, which names every bad field", () => {
    expect(readFormSource("LoginPage.tsx")).toMatch(/resolver: zodResolver\(LoginInput\.schema\)/)
    expect(listClientIssues(LoginInput.schema, badSignIn)).toEqual({
      email: "Enter a valid email address.",
      password: "Enter your password.",
    })
  })

  it("checks the registration form with the registration schema, which names every bad field and a mistyped repeat", () => {
    expect(readFormSource("RegisterPage.tsx")).toMatch(/resolver: zodResolver\(RegisterForm\.schema\)/)
    expect(listClientIssues(RegisterForm.schema, badRegistration)).toEqual({
      email: "Enter a valid email address.",
      password: "Use at least 12 characters.",
      captchaToken: "Complete the CAPTCHA to continue.",
    })
    expect(
      listClientIssues(RegisterForm.schema, {
        email: "pat@example.com",
        password: "correct horse battery staple",
        confirmPassword: "correct horse battery stapel",
        captchaToken: "solved",
      }),
    ).toEqual({ confirmPassword: "The two passwords do not match." })
  })
})

describe("the server", () => {
  it("refuses a bad registration with 422 and the same complaint about each field, and makes no account", async () => {
    expect(await listServerIssues("/auth/register", badRegistrationBody)).toEqual(listClientIssues(RegisterForm.schema, badRegistration))
    expect(await harness.database.sql`SELECT id FROM app_user`).toHaveLength(0)
  })

  it("refuses a bad sign-in with 422 and the same complaint about each field", async () => {
    expect(await listServerIssues("/auth/login", badSignIn)).toEqual(listClientIssues(LoginInput.schema, badSignIn))
  })

  it("refuses a body with a field missing or of the wrong type, which no form would send", async () => {
    expect(Object.keys(await listServerIssues("/auth/register", { email: 42, password: ["correct horse battery staple"] }))).toEqual(
      expect.arrayContaining(["email", "password", "captchaToken"]),
    )
  })
})
