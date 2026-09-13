/**
 * Checks that every picture of a category keeps the same margin: the fewest
 * pixels between its content and an edge. Prints one line per category and
 * exits with 1 when a category disagrees, listing the pictures that differ
 * from the margin most of them share.
 */

import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Seed } from "../src/db/seed.ts";
import { Raster } from "./catalog/raster.ts";

let disagreement = false;
for (const category of (await Seed.catalog()).categories) {
  const pictures = new Map<number, string[]>();
  for (const product of category.products) {
    const { data, info } = await sharp(fileURLToPath(new URL(`media/${product.image}`, Seed.CATALOG_DIR))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const margin = Raster.margin({ data, width: info.width, height: info.height });
    pictures.set(margin, [...(pictures.get(margin) ?? []), product.image]);
  }

  const [shared, ...odd] = [...pictures.entries()].sort((a, b) => b[1].length - a[1].length);
  if (shared === undefined) continue;
  process.stdout.write(`${category.name}: ${shared[0]} px on ${shared[1].length} of ${category.products.length} pictures\n`);
  for (const [margin, images] of odd) {
    disagreement = true;
    process.stdout.write(`  ${margin} px: ${images.join(", ")}\n`);
  }
}

process.exitCode = disagreement ? 1 : 0;
