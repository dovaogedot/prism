import { describe, expect, it } from "vitest";
import { OrderQueryParams, OrderStatus } from "../../src/contracts/orders.ts";

describe("OrderQueryParams", () => {
  it("applies defaults to an empty query string", () => {
    expect(OrderQueryParams.schema.parse({})).toEqual({ sort: "newest", page: 1, perPage: 10 });
  });

  it("accepts one status or a repeated key", () => {
    expect(OrderQueryParams.schema.parse({ status: "shipped" }).status).toEqual(["shipped"]);
    expect(OrderQueryParams.schema.parse({ status: ["shipped", "canceled"] }).status).toEqual(["shipped", "canceled"]);
  });

  it("refuses an unknown status or sort", () => {
    expect(OrderQueryParams.schema.safeParse({ status: "lost" }).success).toBe(false);
    expect(OrderQueryParams.schema.safeParse({ sort: "price" }).success).toBe(false);
  });

  it("accepts a date range whose ends may be the same day", () => {
    expect(OrderQueryParams.schema.parse({ from: "2026-08-01", to: "2026-08-01" })).toMatchObject({
      from: "2026-08-01",
      to: "2026-08-01",
    });
  });

  it("refuses a range that ends before it starts, and a date that is not a date", () => {
    expect(OrderQueryParams.schema.safeParse({ from: "2026-08-02", to: "2026-08-01" }).success).toBe(false);
    expect(OrderQueryParams.schema.safeParse({ from: "2026-02-30" }).success).toBe(false);
    expect(OrderQueryParams.schema.safeParse({ from: "yesterday" }).success).toBe(false);
  });
});

describe("OrderStatus", () => {
  it("lets only unprocessed orders be canceled", () => {
    const cancelable = OrderStatus.NAMES.filter((status) => OrderStatus.isCancelable(status));
    expect(cancelable).toEqual(["pending_payment", "payment_successful"]);
  });

  it("labels every status", () => {
    for (const status of OrderStatus.NAMES) expect(OrderStatus.label[status].length, status).toBeGreaterThan(0);
  });
});
