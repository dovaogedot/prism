import { describe, expect, it } from "vitest"
import { App } from "../../src/app.ts"

describe("a request's log line", () => {
  it("leaves out the query string, where order keys and reset tokens travel", () => {
    const logged = App.requestForLog({ method: "GET", url: "/api/v1/orders/abc?key=secret-key&x=1", ip: "203.0.113.5" })

    expect(logged).toEqual({ method: "GET", url: "/api/v1/orders/abc", remoteAddress: "203.0.113.5" })
  })
})
