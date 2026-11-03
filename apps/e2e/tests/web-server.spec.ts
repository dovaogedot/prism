/**
 * What the web server in front of the API does with a request before the
 * app sees it: the visitor's address it hands on to the rate limits.
 */

import { expect, test } from "@playwright/test"

test("a made-up X-Forwarded-For address buys no rate-limit budget of its own", async ({ request }) => {
  // The contact form's budget refills slowest of those counted per address,
  // so each request it takes shows in what is left. An empty message is
  // refused after its token is taken, and sends nothing.
  const remaining: number[] = []
  for (let index = 1; index <= 5; index += 1) {
    const answer = await request.post("/api/v1/support/messages", { data: {}, headers: { "x-forwarded-for": `203.0.113.${index}` } })
    expect(answer.status()).toBe(422)
    remaining.push(Number(answer.headers()["ratelimit-remaining"]))
  }

  // A bucket of its own for each made-up address would leave the same number every time.
  expect(remaining.at(-1)).toBeLessThan(remaining[0] ?? 0)
})
