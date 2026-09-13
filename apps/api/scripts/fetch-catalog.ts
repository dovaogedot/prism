/**
 * Writes the catalog the seed plants: `seed/catalog.json` and one picture
 * per product under `seed/media/`, from the sources under `catalog/`. Run
 * by hand when a source changes; the seed itself never touches the network.
 *
 * Every picture is cut to its content, given the same margin as the rest
 * of its category, and scaled up pixel for pixel, so a browser has no need
 * to blur it. `check-margins.ts` verifies the margins afterwards.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { faker } from "@faker-js/faker";
import sharp, { type Sharp } from "sharp";
import { Seed } from "../src/db/seed.ts";
import { SeedCatalog, type SeedProduct } from "../src/db/seed-catalog.ts";
import { Balatro } from "./catalog/balatro.ts";
import { Isaac } from "./catalog/isaac.ts";
import { Raster, type Raw } from "./catalog/raster.ts";
import { Sourced, type Picture } from "./catalog/sourced.ts";

const MEDIA_DIR = new URL("media/", Seed.CATALOG_DIR);

// Editions, prices and the like are drawn under a fixed seed, so two runs write the same file.
faker.seed(42);

/** Each source with the transparent margin its pictures get, in pixels of the art, and how many times they are scaled up. */
const sources = [
  { name: "Balatro", brand: "LocalThunk", margin: 2, scale: 8, products: await Balatro.fetch() },
  { name: "The Binding of Isaac", brand: "Nicalis", margin: 23, scale: 6, products: await Isaac.fetch() },
];

const downloads = new Map<string, Promise<Buffer>>();

/** The bytes at `url`, fetched once however many pictures share the file. */
const fetched = (url: string): Promise<Buffer> => {
  const bytes = downloads.get(url) ?? Sourced.bytes(url);
  downloads.set(url, bytes);
  return bytes;
};

/** `image` as pixels. */
const raw = async (image: Sharp): Promise<Raw> => {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** The content of `picture` at one pixel per pixel of the art. */
const content = async (picture: Picture): Promise<Raw> => {
  const whole = await raw(
    sharp(await fetched(picture.url))
      .extract({ left: picture.left, top: picture.top, width: picture.width, height: picture.height })
      .resize({ width: Math.round(picture.width / picture.unit), height: Math.round(picture.height / picture.unit), kernel: "nearest" }),
  );

  return Raster.cropped(whole, Raster.bounds(whole));
};

/** `art` with `margin` transparent pixels on every side, scaled up `scale` times pixel for pixel. */
const framed = (art: Raw, margin: number, scale: number): Promise<Raw> =>
  raw(
    sharp(art.data, { raw: { width: art.width, height: art.height, channels: 4 } })
      .resize({ width: art.width * scale, height: art.height * scale, kernel: "nearest" })
      .extend({ top: margin * scale, bottom: margin * scale, left: margin * scale, right: margin * scale, background: { r: 0, g: 0, b: 0, alpha: 0 } }),
  );

/**
 * The PNG of `product`'s picture: its faces put under the art, then the art
 * framed, then its shaders run over the frame. Nothing when the art has no
 * solid pixel, since a translucent picture has no edge to frame.
 */
const png = async (product: Sourced, margin: number, scale: number): Promise<Buffer | undefined> => {
  let art = await content(product.picture);
  if (Raster.blank(art)) return undefined;
  for (const finish of product.finishes) {
    if (finish._tag === "Face") art = Raster.faced(await content(finish.picture), art, finish.ink);
  }

  let frame = await framed(art, margin, scale);
  for (const finish of product.finishes) {
    if (finish._tag === "Shader") frame = Raster.shaded(frame, finish.shade);
  }

  return sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } }).png({ compressionLevel: 9 }).toBuffer();
};

await mkdir(MEDIA_DIR, { recursive: true });

const files = new Set<string>();
const categories = [];
for (const source of sources) {
  const prefix = Seed.slugOf(source.name, new Set());
  const products: SeedProduct[] = [];

  for (const { picture, finishes, ...product } of source.products) {
    const bytes = await png({ ...product, picture, finishes }, source.margin, source.scale);
    if (bytes === undefined) {
      process.stderr.write(`Skipping ${product.name}: its picture has no solid pixel.\n`);
      continue;
    }

    const image = `${Seed.slugOf(`${prefix} ${product.name}`, files)}.png`;
    await writeFile(new URL(image, MEDIA_DIR), bytes);
    products.push({ ...product, image });
  }

  categories.push({ name: source.name, brand: source.brand, products });
  process.stdout.write(`${source.name}: ${products.length} products\n`);
}

await writeFile(new URL("catalog.json", Seed.CATALOG_DIR), `${JSON.stringify(SeedCatalog.schema.parse({ categories }), null, 2)}\n`);
