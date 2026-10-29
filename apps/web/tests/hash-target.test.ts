import { NavigationType } from "react-router"
import { describe, expect, it } from "vitest"
import { HashTarget } from "../src/shared/layout/hash-target.ts"

describe("HashTarget.isFollowed", () => {
  it("brings a hash into view after a link inside the shop", () => {
    expect(HashTarget.isFollowed(NavigationType.Push, "k1")).toBe(true)
    expect(HashTarget.isFollowed(NavigationType.Replace, "k2")).toBe(true)
  })

  it("leaves Back and Forward to restore their own position", () => {
    expect(HashTarget.isFollowed(NavigationType.Pop, "k3")).toBe(false)
  })
})
