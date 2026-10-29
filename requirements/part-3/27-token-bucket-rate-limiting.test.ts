/**
 * REQUIREMENTS_3.md: "Token bucket rate limiting is implemented."
 *
 * The contact form's budget is the one checked: a burst of 3, and one more
 * every 5 minutes. The app is built with the limits the shop runs with,
 * where the harness's own app has them scaled out of the way.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { App, type Application } from "../../apps/api/src/app.ts"
import { Config } from "../../apps/api/src/config.ts"
import { Topology } from "../../apps/api/src/messaging/topology.ts"
import { MessageQueue } from "../../apps/api/src/platform/queue.ts"
import { startHarness, testEnvironment, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness
let limited: Application

beforeAll(async () => {
  harness = await startHarness()
  limited = await App.build({
    config: Config.fromEnvironment(testEnvironment(harness.config.database.url, harness.mediaDirectory, 1)),
    database: harness.database,
    overrides: { clock: harness.clock, mailer: harness.mailer, queue: MessageQueue.memory(Topology.declarations()) },
  })
}, 180_000)

afterAll(async () => {
  await limited.app.close()
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
})

/** Sends a contact message from `address`, and answers its status and Retry-After. */
const sendFrom = async (address: string) => {
  const response = await limited.app.inject({
    method: "POST",
    url: "/api/v1/support/messages",
    remoteAddress: address,
    payload: { name: "Mari", email: "mari@example.com", topic: "other", message: "Is the lamp back in stock?", captchaToken: "test-token" },
  })

  return [response.statusCode, response.headers["retry-after"]] as const
}

/** Sends `count` messages from `address`, one after another, and answers their statuses. */
const burstFrom = async (address: string, count: number): Promise<readonly number[]> => {
  const statuses: number[] = []

  for (let index = 0; index < count; index += 1) {
    statuses.push((await sendFrom(address))[0])
  }

  return statuses
}

describe("the contact form's token bucket", () => {
  it("lets a burst up to its capacity through at once, then refuses with the wait until the next token", async () => {
    expect(await burstFrom("203.0.113.20", 3)).toEqual([202, 202, 202])
    expect(await sendFrom("203.0.113.20")).toEqual([429, "300"])
  })

  it("refills one token at a time, at a steady rate: half the interval gives none, the whole interval one", async () => {
    await burstFrom("203.0.113.21", 3)

    harness.clock.advanceSeconds(150)
    expect(await sendFrom("203.0.113.21")).toEqual([429, "150"])

    harness.clock.advanceSeconds(150)
    expect(await burstFrom("203.0.113.21", 2)).toEqual([202, 429])
  })

  it("fills up to its capacity and no further, however long it waits", async () => {
    await burstFrom("203.0.113.22", 3)

    harness.clock.advanceSeconds(24 * 60 * 60)

    expect(await burstFrom("203.0.113.22", 4)).toEqual([202, 202, 202, 429])
  })

  it("keeps one bucket per client address", async () => {
    await burstFrom("203.0.113.23", 4)

    expect(await sendFrom("203.0.113.24")).toEqual([202, undefined])
  })
})
