/**
 * The tables' CHECK constraints, each proven by a row that breaks it. The
 * database is the last line of defense, so every rule here holds even for a
 * write that bypasses the services.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertUser, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

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
  estimated_delivery_from: "'2026-08-10'",
  estimated_delivery_to: "'2026-08-12'",
};

const insertOrder = (overrides: Partial<typeof order> = {}) => {
  const row = { ...order, ...overrides };

  return harness.database.sql.unsafe(`
    INSERT INTO customer_order
      (status, shipping_method, shipping_method_name, estimated_delivery_from, estimated_delivery_to,
       subtotal_cents, shipping_cents, total_cents, contact, shipping_address, email_index,
       access_key, tracking_number, payment_due_at)
    VALUES (${row.status}, ${row.shipping_method}, 'Standard', ${row.estimated_delivery_from}, ${row.estimated_delivery_to},
            ${row.subtotal_cents}, ${row.shipping_cents}, ${row.total_cents}, '\\x01'::bytea, '\\x01'::bytea, '\\x02'::bytea,
            ${row.access_key}, ${row.tracking_number}, now())
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
    await violates(insertOrder({ shipping_method: "'drone'" }), "customer_order_shipping_method_shipping_method_code_fk");
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

  it("carries a tracking number once shipped, and only from then on", async () => {
    await violates(insertOrder({ status: "'shipped'" }), "customer_order_tracking_when_shipped");
    await violates(insertOrder({ status: "'delivered'" }), "customer_order_tracking_when_shipped");
    await violates(insertOrder({ tracking_number: "'PR1EE'" }), "customer_order_tracking_after_shipping");
    await expect(insertOrder({ status: "'delivered'", tracking_number: "'PR1EE'" })).resolves.toHaveLength(1);
    await expect(insertOrder({ status: "'refunded'", tracking_number: "'PR1EE'" })).resolves.toHaveLength(1);
  });

  it("refuses a delivery window that ends before it starts", async () => {
    await violates(
      insertOrder({ estimated_delivery_from: "'2026-08-12'", estimated_delivery_to: "'2026-08-10'" }),
      "customer_order_delivery_window",
    );
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

describe("app_user", () => {
  it("holds only known staff roles", async () => {
    const id = await insertUser(harness, "staff@example.com");

    await violates(
      harness.database.sql`UPDATE app_user SET roles = ARRAY['owner']::text[] WHERE id = ${id}`,
      "app_user_roles_known",
    );
    await violates(
      harness.database.sql`UPDATE app_user SET roles = ARRAY[NULL]::text[] WHERE id = ${id}`,
      "app_user_roles_known",
    );
    await expect(
      harness.database.sql`UPDATE app_user SET roles = ARRAY['moderator', 'admin']::text[] WHERE id = ${id} RETURNING id`,
    ).resolves.toHaveLength(1);
  });

  it("refuses 2FA turned on without a secret", async () => {
    const id = await insertUser(harness, "no-secret@example.com");

    await violates(
      harness.database.sql`UPDATE app_user SET totp_enabled_at = now() WHERE id = ${id}`,
      "app_user_totp_needs_secret",
    );
  });

  it("keeps one account per email through the blind index", async () => {
    await insertUser(harness, "twice@example.com");

    await expect(insertUser(harness, "twice@example.com")).rejects.toMatchObject({
      cause: { constraint_name: "app_user_email_index_key" },
    });
  });
});

describe("product_image and product_review", () => {
  const productId = async () => {
    await seedCatalog(harness, [{ slug: "lamp", name: "Lamp", priceCents: 1000 }]);
    const [row] = await harness.database.sql`SELECT id FROM product`;
    return String(row?.["id"]);
  };

  it("records both sides of an image's size or neither, and never zero", async () => {
    const product = await productId();
    const image = (width: string, height: string) =>
      harness.database.sql.unsafe(
        `INSERT INTO product_image (product_id, file, width, height) VALUES ('${product}', 'a.png', ${width}, ${height})`,
      );

    await violates(image("100", "NULL"), "product_image_size_whole");
    await violates(image("0", "100"), "product_image_size_positive");
  });

  it("refuses a review outside the length, status and count rules", async () => {
    const product = await productId();
    const author = await insertUser(harness, "author@example.com");
    const review = (columns: Readonly<Record<string, string>>) => {
      const row = { author_name: "'Mari'", title: "NULL", body: "NULL", status: "'pending'", rejection_reason: "NULL", helpful_count: "0", ...columns };

      return harness.database.sql.unsafe(`
        INSERT INTO product_review (product_id, user_id, rating, author_name, title, body, status, rejection_reason, helpful_count)
        VALUES ('${product}', '${author}', 5, ${row.author_name}, ${row.title}, ${row.body}, ${row.status},
                ${row.rejection_reason}, ${row.helpful_count})`);
    };

    await violates(review({ author_name: "'M'" }), "product_review_author_length");
    await violates(review({ author_name: `'${"m".repeat(41)}'` }), "product_review_author_length");
    await violates(review({ title: "''" }), "product_review_title_length");
    await violates(review({ title: `'${"t".repeat(121)}'` }), "product_review_title_length");
    await violates(review({ body: `'${"b".repeat(2001)}'` }), "product_review_body_length");
    await violates(review({ status: "'hidden'" }), "product_review_status_known");
    await violates(review({ status: "'rejected'" }), "product_review_reason_when_rejected");
    await violates(review({ rejection_reason: "'Spam'" }), "product_review_reason_when_rejected");
    await violates(review({ helpful_count: "-1" }), "product_review_helpful_not_negative");
  });

  it("keeps a product's rating at 0 without reviews and between 1 and 5 with them", async () => {
    const product = await productId();
    const rate = (average: string, count: string) =>
      harness.database.sql.unsafe(`UPDATE product SET rating_average = ${average}, rating_count = ${count} WHERE id = '${product}'`);

    await violates(rate("4.5", "0"), "product_rating_range");
    await violates(rate("0", "2"), "product_rating_range");
    await violates(rate("5.5", "2"), "product_rating_range");
    await violates(rate("3", "-1"), "product_rating_range");
  });
});

describe("shipping_method", () => {
  const method = (price: string, freeFrom: string, minDays: string, maxDays: string) =>
    harness.database.sql.unsafe(`
      INSERT INTO shipping_method (code, name, price_cents, free_from_cents, min_days, max_days)
      VALUES ('pigeon', 'Pigeon', ${price}, ${freeFrom}, ${minDays}, ${maxDays})`);

  it("refuses a negative price, a threshold of zero and an impossible window", async () => {
    await violates(method("-1", "NULL", "1", "2"), "shipping_method_price_not_negative");
    await violates(method("100", "0", "1", "2"), "shipping_method_free_from_positive");
    await violates(method("100", "NULL", "0", "2"), "shipping_method_days_range");
    await violates(method("100", "NULL", "3", "2"), "shipping_method_days_range");
    await violates(method("100", "NULL", "1", "31"), "shipping_method_days_range");
  });

  it("cannot be deleted while an order uses it", async () => {
    await insertOrder();

    await violates(
      harness.database.sql`DELETE FROM shipping_method WHERE code = 'standard'`,
      "customer_order_shipping_method_shipping_method_code_fk",
    );
  });
});

describe("address", () => {
  it("keeps at most one default per customer", async () => {
    const owner = await insertUser(harness, "owner@example.com");
    const address = (isDefault: boolean) =>
      harness.database.sql`INSERT INTO address (user_id, details, is_default) VALUES (${owner}, '\\x01'::bytea, ${isDefault})`;

    await address(true);
    await address(false);
    await violates(address(true), "address_one_default_key");
  });
});

describe("audit_event", () => {
  it("is append-only: an update or a delete raises", async () => {
    await harness.database.sql`
      INSERT INTO audit_event (action, target_type, summary) VALUES ('system.test', 'system', 'A row to keep')`;

    await expect(harness.database.sql`UPDATE audit_event SET summary = 'changed'`).rejects.toThrow(/append-only/);
    await expect(harness.database.sql`DELETE FROM audit_event`).rejects.toThrow(/append-only/);
    expect(await harness.database.sql`SELECT summary FROM audit_event`).toEqual([{ summary: "A row to keep" }]);
  });
});
