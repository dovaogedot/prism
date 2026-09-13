/**
 * What every source of the catalog hands the fetch script: products with
 * the whereabouts of their pictures, and the polite HTTP the sources share.
 */

import { setTimeout as sleep } from "node:timers/promises";
import type { Rgba, Shader } from "./raster.ts";

/**
 * Where a product's picture is: a box on an image on the web. `unit` is how
 * many pixels of the image make one pixel of the art; the box is scaled down
 * by it, so every source lands at the same scale.
 */
export type Picture = Readonly<{ url: string; left: number; top: number; width: number; height: number; unit: number }>;

/**
 * A touch put on a picture once fetched. A face goes under the picture:
 * the pixels `ink` accepts, and those they enclose, stay, and the face
 * shows through the rest. A shader recolors every pixel.
 */
export type Finish =
  | Readonly<{ _tag: "Face"; picture: Picture; ink: (color: Rgba) => boolean }>
  | Readonly<{ _tag: "Shader"; shade: Shader }>;

/** A product as its source describes it, the picture still to be fetched and finished. */
export type Sourced = Readonly<{
  name: string;
  description: string;
  priceCents: number;
  properties: Readonly<Record<string, string>>;
  picture: Picture;
  finishes: readonly Finish[];
}>;

export const Sourced = {
  USER_AGENT: "prism-seed/1.0 (student project; fetches the catalog once)",

  /** The response for `url`, a beat after the previous request so no source is hammered. Throws on any status but success. */
  get: async (url: string): Promise<Response> => {
    await sleep(150);
    const response = await fetch(url, { headers: { "user-agent": Sourced.USER_AGENT } });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response;
  },

  /** The bytes at `url`. */
  bytes: async (url: string): Promise<Buffer> => Buffer.from(await (await Sourced.get(url)).arrayBuffer()),

  /** The properties among `fields` that have a value. */
  properties: (fields: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>> =>
    Object.fromEntries(Object.entries(fields).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]]))),
} as const;
