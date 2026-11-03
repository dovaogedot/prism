import type { OrderEvent, OrderStatus } from "@prism/shared"
import { describe, expect, it } from "vitest"
import { OrderPolling, OrderStanding } from "../src/features/orders/orders.ts"

/** A timeline that went through `statuses`, oldest first. */
const timelineOf = (...statuses: readonly OrderStatus[]): readonly OrderEvent[] =>
  statuses.map((status, index) => ({ status, at: `2026-11-03T12:00:0${index}.000Z` }))

describe("OrderStanding.readShown", () => {
  it("takes the timeline's newest status over the order's own, which was read before it", () => {
    const order = { status: "pending_payment", events: timelineOf("pending_payment", "payment_successful") } as const

    expect(OrderStanding.readRecorded(order)).toBe("payment_successful")
    expect(OrderStanding.readShown({ ...order, payment: { status: "succeeded" } })).toBe("payment_successful")
  })

  it("shows the outcome of a payment that settled before the order heard of it, while the order still records it as pending", () => {
    const waiting = { status: "pending_payment", events: timelineOf("pending_payment") } as const

    expect(OrderStanding.readShown({ ...waiting, payment: { status: "succeeded" } })).toBe("payment_successful")
    expect(OrderStanding.readShown({ ...waiting, payment: { status: "failed" } })).toBe("payment_failed")
    expect(OrderStanding.readShown({ ...waiting, payment: { status: "pending" } })).toBe("pending_payment")
    expect(OrderStanding.readShown(waiting)).toBe("pending_payment")
    expect(OrderStanding.readRecorded(waiting)).toBe("pending_payment")
  })

  it("leaves an order that moved on as it is, whatever its payment says", () => {
    const canceled = { status: "canceled", events: timelineOf("pending_payment", "canceled"), payment: { status: "succeeded" } } as const

    expect(OrderStanding.readShown(canceled)).toBe("canceled")
  })
})

describe("OrderPolling.findInterval", () => {
  it("reads again soon after the first answer, then doubles the wait up to the usual interval", () => {
    expect([1, 2, 3, 4, 5, 20].map((reads) => OrderPolling.findInterval(reads))).toEqual([250, 500, 1000, 2000, 2000, 2000])
  })
})
