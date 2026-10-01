/**
 * The commerce tables' CHECK constraints, each proven by a row that breaks
 * it. The database is the last line of defense, so every rule here holds
 * even for a write that bypasses the services.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
});

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
});

/** A valid order row's columns, which each test breaks one at a time. */
const order = {
  status: "'pending_payment'",
  shipping_method: "'standard'",
  subtotal_cents: "1000",
  shipping_cents: "490",
  total_cents: "1490",
  access_key: "'\\x01'::bytea",
  tracking_number: "NULL",
};

const insertOrder = (overrides: Partial<typeof order> = {}) => {
  const row = { ...order, ...overrides };

  return harness.database.sql.unsafe(`
    INSERT INTO customer_order
      (status, shipping_method, subtotal_cents, shipping_cents, total_cents, contact, shipping_address,
       access_key, tracking_number, payment_due_at)
    VALUES (${row.status}, ${row.shipping_method}, ${row.subtotal_cents}, ${row.shipping_cents}, ${row.total_cents},
            '\\x01'::bytea, '\\x01'::bytea, ${row.access_key}, ${row.tracking_number}, now())
    RETURNING id`);
};

/** Expects `statement` to fail on the named constraint. */
const violates = async (statement: Promise<unknown>, constraint: string) => {
  await expect(statement).rejects.toMatchObject({ constraint_name: constraint });
};

describe("cart", () => {
  it("has exactly one owner", async () => {
    await violates(harness.database.sql.unsafe("INSERT INTO cart (expires_at) VALUES (now())"), "cart_one_owner");
  });

  it("expires when it belongs to a guest", async () => {
    await violates(harness.database.sql.unsafe("INSERT INTO cart (token_hash) VALUES ('abc')"), "cart_guest_expires");
  });

  it("holds 1 to 99 of a product", async () => {
    await seedCatalog(harness, [{ slug: "lamp", name: "Lamp", priceCents: 1000 }]);
    const [cart] = await harness.database.sql.unsafe(
      "INSERT INTO cart (token_hash, expires_at) VALUES ('abc', now()) RETURNING id",
    );

    for (const quantity of [0, 100]) {
      await violates(
        harness.database.sql.unsafe(
          `INSERT INTO cart_item (cart_id, product_id, quantity) SELECT '${cart?.["id"]}', id, ${quantity} FROM product`,
        ),
        "cart_item_quantity_range",
      );
    }
  });
});

describe("customer_order", () => {
  it("accepts the valid baseline row", async () => {
    await expect(insertOrder()).resolves.toHaveLength(1);
  });

  it("refuses an unknown status or shipping method", async () => {
    await violates(insertOrder({ status: "'lost'" }), "customer_order_status_known");
    await violates(insertOrder({ shipping_method: "'drone'" }), "customer_order_shipping_known");
  });

  it("refuses negative money and a total that does not add up", async () => {
    await violates(
      insertOrder({ subtotal_cents: "-10", shipping_cents: "10", total_cents: "0" }),
      "customer_order_money_not_negative",
    );
    await violates(insertOrder({ total_cents: "1491" }), "customer_order_total_adds_up");
  });

  it("refuses an order neither a user nor a key can reach", async () => {
    await violates(insertOrder({ access_key: "NULL" }), "customer_order_has_owner");
  });

  it("carries a tracking number exactly when shipped or delivered", async () => {
    await violates(insertOrder({ status: "'shipped'" }), "customer_order_tracking_when_shipped");
    await violates(insertOrder({ tracking_number: "'PR1EE'" }), "customer_order_tracking_when_shipped");
    await expect(insertOrder({ status: "'delivered'", tracking_number: "'PR1EE'" })).resolves.toHaveLength(1);
  });
});

describe("order_line, order_event and payment", () => {
  it("refuses a line whose total does not add up, or with no quantity or a negative price", async () => {
    const [placed] = await insertOrder();
    const line = (quantity: number, unit: number, total: number) =>
      harness.database.sql.unsafe(`
        INSERT INTO order_line (order_id, product_name, product_slug, unit_price_cents, quantity, line_total_cents)
        VALUES ('${placed?.["id"]}', 'Lamp', 'lamp', ${unit}, ${quantity}, ${total})`);

    await violates(line(2, 500, 999), "order_line_total_adds_up");
    await violates(line(0, 500, 0), "order_line_quantity_positive");
    await violates(line(1, -5, -5), "order_line_price_not_negative");
  });

  it("refuses an event with an unknown status", async () => {
    const [placed] = await insertOrder();
    await violates(
      harness.database.sql.unsafe(`INSERT INTO order_event (order_id, status) VALUES ('${placed?.["id"]}', 'lost')`),
      "order_event_status_known",
    );
  });

  it("refuses an unknown kind or status, and a negative amount", async () => {
    const [placed] = await insertOrder();
    const payment = (kind: string, status: string, amount: number) =>
      harness.database.sql.unsafe(`
        INSERT INTO payment (order_id, kind, status, amount_cents)
        VALUES ('${placed?.["id"]}', '${kind}', '${status}', ${amount})`);

    await violates(payment("tip", "pending", 100), "payment_kind_known");
    await violates(payment("charge", "lost", 100), "payment_status_known");
    await violates(payment("charge", "pending", -1), "payment_amount_not_negative");
  });

  it("keeps one charge per order", async () => {
    const [placed] = await insertOrder();
    const charge = () =>
      harness.database.sql.unsafe(
        `INSERT INTO payment (order_id, kind, status, amount_cents) VALUES ('${placed?.["id"]}', 'charge', 'pending', 100)`,
      );

    await charge();
    await violates(charge(), "payment_order_kind_key");
  });
});
