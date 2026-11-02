import { afterEach, describe, expect, it, vi } from "vitest"
import { Failure } from "../src/shared/api/failure.tsx"
import { Api, ApiError, NetworkError } from "../src/shared/api/client.ts"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("Failure.message", () => {
  it("shows the API's own sentence for a refusal", () => {
    expect(Failure.message(new ApiError(409, { code: "SlugTaken", message: "Another product uses this slug.", issues: [] }))).toBe(
      "Another product uses this slug.",
    )
  })

  it("calls a request that got no answer a lost connection", () => {
    expect(Failure.message(new NetworkError(new TypeError("Failed to fetch")))).toBe(Failure.OFFLINE)
  })

  it("calls anything else a fault of the page, and logs it", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)

    expect(Failure.message(new SyntaxError("Unexpected token '<'"))).toBe(Failure.UNEXPECTED)
    expect(logged).toHaveBeenCalledOnce()
  })
})

describe("an answer the page cannot read", () => {
  /** What the page shows for an answer of `status` whose body is the proxy's own page rather than the API's JSON. */
  const messageFor = async (status: number): Promise<string> => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Bad gateway</body></html>", { status, headers: { "content-type": "text/html" } })),
    )
    return Failure.message(await Api.request("/cart").catch((reason: unknown) => reason))
  }

  it("calls a 502, 503 or 504 from the proxy a shop restarting or too busy, and asks for a retry in a few seconds", async () => {
    for (const status of [502, 503, 504]) {
      expect(await messageFor(status), String(status)).toBe(
        "The shop is restarting or too busy to answer. Wait a few seconds and try again.",
      )
    }
  })

  it("asks for a reload when any other answer cannot be read", async () => {
    expect(await messageFor(500)).toBe("The shop sent an answer this page cannot read. Reload the page and try again.")
  })
})
