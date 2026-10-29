import { afterEach, describe, expect, it, vi } from "vitest"
import { Failure } from "../src/shared/api/failure.tsx"
import { ApiError, NetworkError } from "../src/shared/api/client.ts"

afterEach(() => {
  vi.restoreAllMocks()
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
