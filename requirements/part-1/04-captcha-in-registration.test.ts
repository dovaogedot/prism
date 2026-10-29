/**
 * REQUIREMENTS_1.md: "CAPTCHA is integrated into the registration process."
 *
 * The API is built here with a stand-in for Google's verification that
 * passes one token and fails every other, so the checks see the server ask
 * the provider and act on its answer without reaching Google.
 */

import { okAsync, errAsync } from "neverthrow"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { App, type Application } from "../../apps/api/src/app.ts"
import { Topology } from "../../apps/api/src/messaging/topology.ts"
import { CaptchaVerifier } from "../../apps/api/src/platform/captcha.ts"
import { MessageQueue } from "../../apps/api/src/platform/queue.ts"
import { fastHasher, jsonOf, startHarness, VALID_PASSWORD, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness
let shop: Application

/** Every token the stand-in provider was asked about. */
const asked: string[] = []

beforeAll(async () => {
  harness = await startHarness()
  shop = await App.build({
    config: harness.config,
    database: harness.database,
    overrides: {
      clock: harness.clock,
      mailer: harness.mailer,
      hasher: fastHasher,
      queue: MessageQueue.memory(Topology.declarations()),
      captcha: {
        verify: (token) => {
          asked.push(token)

          return token === "solved" ? okAsync(true as const) : errAsync(CaptchaVerifier.rejected)
        },
      },
    },
  })
}, 180_000)

afterAll(async () => {
  await shop.app.close()
  await harness.stop()
})

const register = (email: string, captcha: { captchaToken?: string }) =>
  shop.app.inject({ method: "POST", url: "/api/v1/auth/register", payload: { email, password: VALID_PASSWORD, ...captcha } })

const countAccounts = async (): Promise<number> => (await harness.database.sql`SELECT id FROM app_user`).length

describe("registration", () => {
  it("refuses a request that carries no CAPTCHA token, and makes no account", async () => {
    const response = await register("none@example.com", {})

    expect(response.statusCode).toBe(422)
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "captchaToken" }] })
    expect(await countAccounts()).toBe(0)
  })

  it("refuses a token the CAPTCHA provider does not accept, and makes no account", async () => {
    const response = await register("bot@example.com", { captchaToken: "forged" })

    expect(response.statusCode).toBe(400)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "CaptchaRejected" })
    expect(asked).toContain("forged")
    expect(await countAccounts()).toBe(0)
  })

  it("opens the account once the provider accepts the token", async () => {
    const response = await register("person@example.com", { captchaToken: "solved" })

    expect(response.statusCode).toBe(201)
    expect(asked).toContain("solved")
    expect(await countAccounts()).toBe(1)
  })
})
