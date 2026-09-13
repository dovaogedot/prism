/**
 * What every source of the catalog hands the fetch script: products with
 * the whereabouts of their pictures, and the polite HTTP the sources share.
 */

import { setTimeout as sleep } from "node:timers/promises";

/** Where a product's picture is: a file on the web, or a slice of a sprite sheet. */
export type Picture =
  | Readonly<{ _tag: "File"; url: string }>
  | Readonly<{ _tag: "Sprite"; url: string; left: number; top: number; width: number; height: number }>;

/** A product as its source describes it, the picture still to be fetched. */
export type Sourced = Readonly<{
  name: string;
  description: string;
  priceCents: number;
  properties: Readonly<Record<string, string>>;
  picture: Picture;
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
