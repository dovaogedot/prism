/**
 * The catalog in the admin: products, categories and brands with an audit
 * row for every change, and bulk import that writes a whole file or nothing.
 */

import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Shop } from "../support/commerce.ts";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";
import { Staff, type TestAccount } from "../support/staff.ts";

let harness: Harness;
let content: TestAccount;
let lamps: string;
let acme: string;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, category: "Lamps", brand: "Acme", properties: { Color: "Brass" } },
  ]);
  content = await Staff.account(harness, "content@example.com", ["content_manager"]);
  const [category] = await harness.database.sql`SELECT id FROM category WHERE slug = 'lamps'`;
  const [brand] = await harness.database.sql`SELECT id FROM brand WHERE slug = 'acme'`;
  lamps = String(category?.["id"]);
  acme = String(brand?.["id"]);
});

const productInput = (overrides: Readonly<Record<string, unknown>> = {}) => ({
  name: "Floor Lamp",
  slug: "floor-lamp",
  description: "Tall and bright.",
  priceCents: 8900,
  stock: 4,
  categoryId: lamps,
  brandId: acme,
  weightGrams: 3200,
  widthMm: 300,
  heightMm: 1500,
  depthMm: 300,
  properties: [{ name: "Color", value: "Black" }],
  isFeatured: false,
  ...overrides,
});

const auditOf = async (targetType: string) =>
  harness.database.sql`SELECT action, changes FROM audit_event WHERE target_type = ${targetType} ORDER BY id`;

/** Sends an import file as multipart. */
const importFile = (text: string | Buffer, filename: string, dryRun: boolean) => {
  const boundary = `prism${randomBytes(8).toString("hex")}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/csv\r\n\r\n`),
    Buffer.isBuffer(text) ? text : Buffer.from(text),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return harness.app.inject({
    method: "POST",
    url: `/api/v1/admin/products/import?dryRun=${dryRun}`,
    headers: { authorization: `Bearer ${content.accessToken}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
};

const HEADER = "slug,name,description,price,stock,category,brand,weight_g,width_mm,height_mm,depth_mm,featured,property:Color";
const csvRow = (slug: string, name: string, price = "19.90", color = "Red") =>
  `${slug},${name},A good one.,${price},5,lamps,acme,500,100,200,100,false,${color}`;

describe("products", () => {
  it("creates, edits and deletes a product, recording each change with what changed", async () => {
    const created = await Staff.call(harness, content, "POST", "/admin/products", productInput());
    expect(created.statusCode).toBe(201);
    const id = String(jsonOf(created)["id"]);

    const edited = await Staff.call(harness, content, "PUT", `/admin/products/${id}`, productInput({ priceCents: 7900, stock: 9 }));
    expect(jsonOf(edited)).toMatchObject({ priceCents: 7900, stock: 9, properties: [{ name: "Color", value: "Black" }] });

    expect((await Staff.call(harness, content, "DELETE", `/admin/products/${id}`)).statusCode).toBe(204);
    expect((await Staff.call(harness, content, "GET", `/admin/products/${id}`)).statusCode).toBe(404);

    expect(await auditOf("product")).toEqual([
      { action: "product.create", changes: null },
      { action: "product.update", changes: { priceCents: [8900, 7900], stock: [4, 9] } },
      { action: "product.delete", changes: null },
    ]);
  });

  it("keeps the lines of orders that bought a deleted product", async () => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 2]]));
    const id = await Shop.productId(harness, "desk-lamp");

    await Staff.call(harness, content, "DELETE", `/admin/products/${id}`);

    expect(
      await harness.database.sql`SELECT product_id, product_name, product_slug, quantity FROM order_line WHERE order_id = ${placed.orderId}`,
    ).toEqual([{ product_id: null, product_name: "Desk Lamp", product_slug: "desk-lamp", quantity: 2 }]);
  });

  it("features a product on the home page and keeps when it began", async () => {
    const id = await Shop.productId(harness, "desk-lamp");
    const featured = productInput({ name: "Desk Lamp", slug: "desk-lamp", isFeatured: true });

    await Staff.call(harness, content, "PUT", `/admin/products/${id}`, featured);
    const [first] = await harness.database.sql`SELECT featured_at FROM product WHERE id = ${id}`;
    harness.clock.advanceSeconds(60);
    await Staff.call(harness, content, "PUT", `/admin/products/${id}`, { ...featured, stock: 1 });
    const [second] = await harness.database.sql`SELECT featured_at FROM product WHERE id = ${id}`;

    expect(first?.["featured_at"]).not.toBeNull();
    expect(second?.["featured_at"]).toEqual(first?.["featured_at"]);
  });

  it("refuses a slug another product uses, on the slug field", async () => {
    const response = await Staff.call(harness, content, "POST", "/admin/products", productInput({ slug: "desk-lamp" }));

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "slug", message: "Another product uses this slug." }] });
  });

  it("refuses property names that differ only in case", async () => {
    const response = await Staff.call(
      harness,
      content,
      "POST",
      "/admin/products",
      productInput({ properties: [{ name: "Color", value: "Black" }, { name: "color", value: "White" }] }),
    );

    expect(response.statusCode).toBe(422);
  });

  it("lists products with a filter on low stock", async () => {
    await Staff.call(harness, content, "POST", "/admin/products", productInput());

    const list = jsonOf(await Staff.call(harness, content, "GET", "/admin/products?lowStock=true"));

    expect((list["items"] as { slug: string }[]).map((item) => item.slug)).toEqual(["floor-lamp"]);
  });
});

describe("categories and brands", () => {
  it("refuses to delete a category or a brand that products use", async () => {
    const category = await Staff.call(harness, content, "DELETE", `/admin/categories/${lamps}`);
    const brand = await Staff.call(harness, content, "DELETE", `/admin/brands/${acme}`);

    expect(jsonOf(category)["error"]).toMatchObject({ code: "CategoryInUse" });
    expect(jsonOf(brand)["error"]).toMatchObject({ code: "BrandInUse" });
  });

  it("creates, renames and deletes an unused category, with a description", async () => {
    const created = await Staff.call(harness, content, "POST", "/admin/categories", { slug: "rugs", name: "Rugs", description: "Soft underfoot." });
    const id = String(jsonOf(created)["id"]);

    const renamed = await Staff.call(harness, content, "PUT", `/admin/categories/${id}`, { slug: "rugs", name: "Rugs and mats", description: "" });
    expect(jsonOf(renamed)).toEqual({ id, slug: "rugs", name: "Rugs and mats", productCount: 0 });

    expect((await Staff.call(harness, content, "DELETE", `/admin/categories/${id}`)).statusCode).toBe(204);
    expect((await auditOf("category")).map((row) => row["action"])).toEqual(["category.create", "category.update", "category.delete"]);
  });
});

describe("bulk import", () => {
  const file = [HEADER, csvRow("table-lamp", "Table Lamp"), csvRow("wall-lamp", "Wall Lamp"), csvRow("desk-lamp", "Desk Lamp", "29.90", "Green")].join("\n");

  it("reports a dry run without writing, then writes the file as given", async () => {
    const dry = await importFile(file, "lamps.csv", true);
    expect(jsonOf(dry)).toEqual({ dryRun: true, created: 2, updated: 1, issues: [] });
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM product`).toEqual([{ n: 1 }]);

    const real = await importFile(file, "lamps.csv", false);
    expect(jsonOf(real)).toEqual({ dryRun: false, created: 2, updated: 1, issues: [] });

    expect(
      await harness.database.sql`
        SELECT p.slug, p.price_cents, pp.value AS color FROM product p
        JOIN product_property pp ON pp.product_id = p.id AND pp.name = 'Color' ORDER BY p.slug`,
    ).toEqual([
      { slug: "desk-lamp", price_cents: 2990, color: "Green" },
      { slug: "table-lamp", price_cents: 1990, color: "Red" },
      { slug: "wall-lamp", price_cents: 1990, color: "Red" },
    ]);
    expect((await auditOf("product")).map((row) => row["action"])).toEqual(["product.import"]);
  });

  it("writes nothing when one row is bad, and names its row and column", async () => {
    const bad = [HEADER, csvRow("table-lamp", "Table Lamp"), csvRow("wall-lamp", "Wall Lamp", "12.901")].join("\n");

    const response = await importFile(bad, "lamps.csv", false);

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ code: "ImportInvalid", issues: [{ path: "3:price" }] });
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM product`).toEqual([{ n: 1 }]);
  });

  it("names a category the shop does not have", async () => {
    const unknown = [HEADER, csvRow("table-lamp", "Table Lamp").replace(",lamps,", ",chairs,")].join("\n");

    const dry = jsonOf(await importFile(unknown, "lamps.csv", true));

    expect(dry["issues"]).toEqual([{ row: 2, column: "category", message: "No category has this slug." }]);
  });

  it("refuses 5,001 rows and a 3 MB file", async () => {
    const many = [HEADER, ...Array.from({ length: 5001 }, (_, index) => csvRow(`lamp-${index}`, `Lamp ${index}`))].join("\n");

    const tooMany = await importFile(many, "many.csv", false);
    const tooBig = await importFile(randomBytes(3 * 1024 * 1024), "big.csv", false);

    expect(tooMany.statusCode).toBe(422);
    expect(jsonOf(tooMany)["error"]).toMatchObject({ issues: [{ path: "0:" }] });
    expect(tooBig.statusCode).toBe(413);
  });
});
