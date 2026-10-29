/**
 * REQUIREMENTS_3.md: "Contact/Support page includes functioning contact
 * form."
 *
 * The form's page posts to `POST /support/messages`, the route checked here;
 * the message reaches the support inbox, which the harness's mailer stands
 * in for.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { jsonOf, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness

beforeAll(async () => {
  harness = await startHarness()
}, 180_000)

afterAll(async () => {
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
})

const message = {
  name: "Mari Maasikas",
  email: "mari@example.com",
  topic: "shipping",
  orderNumber: "100123",
  message: "My parcel has not moved for a week. Could you check where it is?",
  captchaToken: "test-token",
}

const send = (body: object) => harness.app.inject({ method: "POST", url: "/api/v1/support/messages", payload: body })

describe("the contact form", () => {
  it("delivers the message to the support inbox, with replies going to the sender, and confirms to the sender", async () => {
    const response = await send(message)

    expect(response.statusCode).toBe(202)
    const [inbox, confirmation] = harness.mailer.sent
    expect(inbox).toMatchObject({ to: harness.config.mail.support, replyTo: "mari@example.com" })
    expect(inbox?.text).toContain(message.message)
    expect(inbox?.text).toContain("Mari Maasikas")
    expect(inbox?.text).toContain("100123")
    expect(confirmation).toMatchObject({ to: "mari@example.com", subject: "We received your message" })
  })

  it("refuses a message with fields missing or malformed, naming each, and sends nothing", async () => {
    const response = await send({ ...message, email: "not an address", message: "Hi", topic: undefined })

    expect(response.statusCode).toBe(422)
    expect((jsonOf(response)["error"] as { issues: { path: string }[] }).issues.map((issue) => issue.path).toSorted()).toEqual([
      "email",
      "message",
      "topic",
    ])
    expect(harness.mailer.sent).toEqual([])
  })

  it("tells the sender when the support inbox could not be reached", async () => {
    harness.mailer.failNext()

    const response = await send(message)

    expect(response.statusCode).toBe(503)
    expect(jsonOf(response)["error"]).toMatchObject({ code: "MessageNotSent" })
  })
})
