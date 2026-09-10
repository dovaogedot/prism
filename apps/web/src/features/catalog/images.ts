/**
 * Which file of a product image to show.
 *
 * A still is rendered once per theme, because the room in it is dressed for
 * the page around it; a photograph is one file for both.
 */

import type { ProductImage } from "@prism/shared";
import { match } from "ts-pattern";
import type { Theme } from "../../shared/theme/use-theme.ts";

/** Where the picture is under this theme. */
export const urlUnder = (image: ProductImage, theme: Theme): string =>
  match(theme)
    .with("light", () => image.url)
    .with("dark", () => image.darkUrl)
    .exhaustive();
