/**
 * Product pictures through the admin: uploads are checked and encoded
 * again, get their smaller copies before the request answers, and lose
 * their files when removed. Housekeeping fills in copies a picture lacks.
 */

import { randomBytes } from "node:crypto";
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { productImages } from "../../src/db/schema.ts";
import { Shop } from "../support/commerce.ts";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";
import { Staff, type TestAccount } from "../support/staff.ts";

let harness: Harness;
let content: TestAccount;
let productId: string;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500 }]);
  content = await Staff.account(harness, "content@example.com", ["content_manager"]);
  productId = await Shop.productId(harness, "desk-lamp");
});

type Picture = { id: string; url: string; width?: number; height?: number; sources: { width: number; url: string }[] };

/** A multipart upload of `bytes` as `filename`, with the picture's text. */
const upload = (bytes: Buffer, filename: string, type: string, alt = "A brass desk lamp") => {
  const boundary = `prism${randomBytes(8).toString("hex")}`;
  const field = (name: string, value: string) =>
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  const body = Buffer.concat([
    field("alt", alt),
    field("isPixelArt", "false"),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  return harness.app.inject({
    method: "POST",
    url: `/api/v1/admin/products/${productId}/images`,
    headers: { authorization: `Bearer ${content.accessToken}`, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
};

/** A photograph-like picture: a smooth gradient, `width` by `height`. */
const photo = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } }).composite([
    { input: Buffer.from(`<svg width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#305080" opacity="0.5"/></svg>`) },
  ]);

const filesUnder = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
};

describe("uploading a picture", () => {
  it.each([
    ["JPEG", "lamp.jpg", "image/jpeg", () => photo(900, 600).jpeg().toBuffer()],
    ["PNG", "lamp.png", "image/png", () => photo(900, 600).png().toBuffer()],
    ["WebP", "lamp.webp", "image/webp", () => photo(900, 600).webp().toBuffer()],
  ])("accepts a %s and answers with its smaller copies", async (_format, filename, type, make) => {
    const response = await upload(await make(), filename, type);

    expect(response.statusCode).toBe(201);
    const [picture] = (jsonOf(response)["images"] as Picture[]) ?? [];
    expect(picture).toMatchObject({ width: 900, height: 600, alt: "A brass desk lamp" });
    expect(picture?.sources.map((source) => source.width)).toEqual([160, 400, 800]);
    for (const source of picture?.sources ?? []) {
      await expect(access(join(harness.mediaDirectory, source.url.replace("/media/", "")))).resolves.toBeUndefined();
    }
  });

  it("refuses what is not a JPEG, PNG or WebP picture, or is too big", async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#ff0000" } }).gif().toBuffer();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const text = Buffer.from("this is not a picture at all");
    const huge = await sharp({ create: { width: 7100, height: 7100, channels: 3, background: "#000000" } }).png().toBuffer();
    const heavy = randomBytes(11 * 1024 * 1024);

    expect((await upload(gif, "lamp.gif", "image/gif")).statusCode).toBe(415);
    expect((await upload(svg, "lamp.svg", "image/svg+xml")).statusCode).toBe(415);
    expect((await upload(text, "lamp.png", "image/png")).statusCode).toBe(415);
    expect((await upload(huge, "huge.png", "image/png")).statusCode).toBe(413);
    expect((await upload(heavy, "heavy.png", "image/png")).statusCode).toBe(413);

    expect(await harness.database.sql`SELECT id FROM product_image`).toHaveLength(0);
  });

  it("requires a text that describes the picture", async () => {
    const response = await upload(await photo(400, 400).png().toBuffer(), "lamp.png", "image/png", "   ");

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path: "alt" }] });
  });

  it("keeps the camera's GPS position out of every stored file", async () => {
    const tagged = await photo(900, 600)
      .jpeg()
      .withExif({ IFD0: { Make: "PrismTestCamera" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "59/1 26/1 0/1" } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const response = await upload(tagged, "lamp.jpg", "image/jpeg");
    expect(response.statusCode).toBe(201);

    for (const file of await filesUnder(harness.mediaDirectory)) {
      const bytes = await readFile(file);
      expect((await sharp(bytes).metadata()).exif, file).toBeUndefined();
      expect(bytes.includes(Buffer.from("PrismTestCamera")), file).toBe(false);
    }
  });

  it("stops at 12 pictures a product", async () => {
    const bytes = await photo(200, 200).png().toBuffer();
    for (let index = 0; index < 12; index += 1) expect((await upload(bytes, "lamp.png", "image/png")).statusCode).toBe(201);

    const response = await upload(bytes, "lamp.png", "image/png");

    expect(jsonOf(response)["error"]).toMatchObject({ code: "ImageLimitReached" });
  });
});

describe("removing a picture", () => {
  it("deletes its files once the row is gone, and records it", async () => {
    const [picture] = jsonOf(await upload(await photo(900, 600).png().toBuffer(), "lamp.png", "image/png"))["images"] as Picture[];
    if (picture === undefined) throw new Error("the upload stored nothing");
    expect(await filesUnder(harness.mediaDirectory)).toHaveLength(4);

    const response = await Staff.call(harness, content, "DELETE", `/admin/products/${productId}/images/${picture.id}`);

    expect(response.statusCode).toBe(200);
    expect(jsonOf(response)["images"]).toEqual([]);
    expect(await filesUnder(harness.mediaDirectory)).toHaveLength(0);
    expect(await harness.database.sql`SELECT action FROM audit_event ORDER BY id`).toContainEqual({ action: "product.image_remove" });
  });

  it("reorders the pictures and sets their texts", async () => {
    const bytes = await photo(300, 300).png().toBuffer();
    await upload(bytes, "a.png", "image/png", "First");
    const [first, second] = jsonOf(await upload(bytes, "b.png", "image/png", "Second"))["images"] as Picture[];
    if (first === undefined || second === undefined) throw new Error("the uploads stored too little");

    const response = await Staff.call(harness, content, "PUT", `/admin/products/${productId}/images`, {
      images: [
        { id: second.id, alt: "Now first" },
        { id: first.id, alt: "Now second" },
      ],
    });

    expect((jsonOf(response)["images"] as { id: string; alt: string }[]).map((image) => [image.id, image.alt])).toEqual([
      [second.id, "Now first"],
      [first.id, "Now second"],
    ]);
  });
});

describe("housekeeping", () => {
  it("makes the smaller copies of a picture that has none", async () => {
    await writeFile(join(harness.mediaDirectory, "seeded.png"), await photo(500, 500).png().toBuffer());
    const [row] = await harness.database.db
      .insert(productImages)
      .values({ productId: productId as never, file: "seeded.png", alt: "Seeded", position: 0 })
      .returning({ id: productImages.id });
    if (row === undefined) throw new Error("no row");

    const report = await harness.jobs.housekeeping.run();

    expect(report.variantsMade).toBe(1);
    expect(await harness.database.sql`SELECT width, height FROM product_image`).toEqual([{ width: 500, height: 500 }]);
    await expect(access(join(harness.mediaDirectory, "variants", row.id, "400.webp"))).resolves.toBeUndefined();
    expect((await harness.jobs.housekeeping.run()).variantsMade).toBe(0);
  });
});
