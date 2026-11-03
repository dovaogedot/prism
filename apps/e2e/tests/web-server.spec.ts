/**
 * What the web server in front of the API does with a request before the
 * app sees it: the visitor's address it hands on to the rate limits, plain
 * HTTP sent to its HTTPS port, and the protocols it offers.
 */

import { get, type IncomingMessage } from "node:http"
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

test("plain HTTP sent to the HTTPS port is redirected to the same address over HTTPS", async ({ baseURL }) => {
  const { host } = new URL(baseURL ?? "https://localhost:3200")
  const answer = await new Promise<IncomingMessage>((resolve, reject) => {
    get(`http://${host}/shop?view=list`, resolve).on("error", reject)
  })
  answer.resume()

  expect(answer.statusCode).toBe(308)
  expect(answer.headers.location).toBe(`https://${host}/shop?view=list`)
})

test("no answer tells the browser to look for HTTP/3, which no stack publishes", async ({ request }) => {
  const answer = await request.get("/")

  expect(answer.status()).toBe(200)
  expect(answer.headers()["alt-svc"]).toBeUndefined()
})
