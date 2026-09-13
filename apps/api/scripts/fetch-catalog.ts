/**
 * Writes the catalog the seed plants: `seed/catalog.json` and one picture
 * per product under `seed/media/`, from the sources under `catalog/`. Run
 * by hand when a source changes; the seed itself never touches the network.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { faker } from "@faker-js/faker";
import sharp from "sharp";
import { match } from "ts-pattern";
import { Seed } from "../src/db/seed.ts";
import { SeedCatalog, type SeedProduct } from "../src/db/seed-catalog.ts";
import { Balatro } from "./catalog/balatro.ts";
import { Isaac } from "./catalog/isaac.ts";
import { Sourced, type Finish, type Picture } from "./catalog/sourced.ts";

const MEDIA_DIR = new URL("media/", Seed.CATALOG_DIR);

// Editions, prices and the like are drawn under a fixed seed, so two runs write the same file.
faker.seed(42);

const sources = [
  { name: "Balatro", brand: "LocalThunk", products: await Balatro.fetch() },
  { name: "The Binding of Isaac", brand: "Nicalis", products: await Isaac.fetch() },
];

const sheets = new Map<string, Promise<Buffer>>();

/** The square, in sheet pixels, a sprite is centered on, so all of them share one scale and have room around them. A sprite that outgrows it gets a square of its own size. */
const SPRITE_CANVAS = 96;

/** How many times a sprite is scaled up, pixel for pixel, so a browser has no need to blur it. */
const SPRITE_SCALE = 6;

/** The PNG of a picture: the file itself, or its slice cut from the sheet, which is fetched once. */
const png = (picture: Picture): Promise<Buffer> =>
  match(picture)
    .with({ _tag: "File" }, ({ url }) => Sourced.bytes(url))
    .with({ _tag: "Sprite" }, async (sprite) => {
      const sheet = sheets.get(sprite.url) ?? Sourced.bytes(sprite.url);
      sheets.set(sprite.url, sheet);
      const side = Math.max(SPRITE_CANVAS, sprite.width, sprite.height);
      const left = Math.floor((side - sprite.width) / 2);
      const top = Math.floor((side - sprite.height) / 2);

      // sharp resizes before it extends, whatever the order of the calls, so the margins are given scaled.
      return sharp(await sheet)
        .extract({ left: sprite.left, top: sprite.top, width: sprite.width, height: sprite.height })
        .resize({ width: sprite.width * SPRITE_SCALE, height: sprite.height * SPRITE_SCALE, kernel: "nearest" })
        .extend({
          left: left * SPRITE_SCALE,
          top: top * SPRITE_SCALE,
          right: (side - sprite.width - left) * SPRITE_SCALE,
          bottom: (side - sprite.height - top) * SPRITE_SCALE,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
    })
    .exhaustive();

/** `picture` with every finish put on it in order; the picture keeps its own transparency throughout. */
const finished = async (picture: Buffer, finishes: readonly Finish[]): Promise<Buffer> => {
  if (finishes.length === 0) return picture;

  const { width = 0, height = 0 } = await sharp(picture).metadata();
  const alpha = await sharp(picture).ensureAlpha().extractChannel("alpha").png().toBuffer();
  let image = await sharp(picture).ensureAlpha().png().toBuffer();

  for (const finish of finishes) {
    image = await match(finish)
      .with({ _tag: "Negate" }, () => sharp(image).negate({ alpha: false }).png().toBuffer())
      .with({ _tag: "Layer" }, ({ blend, svg }) => sharp(image).composite([{ input: Buffer.from(svg(width, height)), blend }]).png().toBuffer())
      .exhaustive();
  }

  return sharp(image).removeAlpha().joinChannel(alpha).png().toBuffer();
};

await mkdir(MEDIA_DIR, { recursive: true });

const files = new Set<string>();
const categories = [];
for (const source of sources) {
  const prefix = Seed.slugOf(source.name, new Set());
  const products: SeedProduct[] = [];

  for (const { picture, finishes, ...product } of source.products) {
    const image = `${Seed.slugOf(`${prefix} ${product.name}`, files)}.png`;
    await writeFile(new URL(image, MEDIA_DIR), await finished(await png(picture), finishes));
    products.push({ ...product, image });
  }

  categories.push({ name: source.name, brand: source.brand, products });
  process.stdout.write(`${source.name}: ${products.length} products\n`);
}

await writeFile(new URL("catalog.json", Seed.CATALOG_DIR), `${JSON.stringify(SeedCatalog.schema.parse({ categories }), null, 2)}\n`);
