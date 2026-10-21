/**
 * Product pictures as queries read them and the API serves them. A query
 * reads a picture's row as JSON; this works out its URLs and the smaller
 * copies it has, from its id and its width alone.
 */

import type { ImageId, ProductImage } from "@prism/shared";
import { sql, type SQL } from "drizzle-orm";
import { ImageStore } from "../../platform/image-store.ts";

/** A `product_image` row as a query reads it. */
export type ImageRow = Readonly<{
  id: ImageId;
  file: string;
  alt: string;
  /** Null until the variants exist. */
  width: number | null;
  height: number | null;
  isPixelArt: boolean;
}>;

export const ImageRows = {
  /** The `product_image` row under `alias` as one JSON object, for a query to select or aggregate. */
  json: (alias: string): SQL =>
    sql.raw(
      `json_build_object('id', ${alias}.id, 'file', ${alias}.file, 'alt', ${alias}.alt, 'width', ${alias}.width, ` +
        `'height', ${alias}.height, 'isPixelArt', ${alias}.is_pixel_art)`,
    ),

  /** The picture as the API serves it. */
  view: (row: ImageRow): ProductImage => ({
    id: row.id,
    url: ImageStore.sourceUrl(row.file),
    alt: row.alt,
    ...(row.width === null || row.height === null ? {} : { width: row.width, height: row.height }),
    isPixelArt: row.isPixelArt,
    sources:
      row.width === null
        ? []
        : ImageStore.variantWidths(row.width).map((width) => ({ width, url: ImageStore.variantUrl(row.id, width) })),
  }),
} as const;
