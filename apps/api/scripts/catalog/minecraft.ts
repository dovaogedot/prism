/**
 * Minecraft's items and blocks as products, read from the Minecraft wiki
 * through its MediaWiki API: every page with an item or block infobox, one
 * product per inventory icon the box shows, pictured by the wiki's icon file.
 */

import { faker } from "@faker-js/faker";
import { z } from "zod";
import { MediaWiki, type Infobox } from "./mediawiki.ts";
import { Sourced } from "./sourced.ts";

const API = "https://minecraft.wiki/api.php";

const responses = {
  extracts: z.object({ query: z.object({ pages: z.array(z.object({ title: z.string(), extract: z.string().optional() })) }) }),
};

/** How a word of a field is read when the field starts with it. */
const leading = (field: string | undefined, words: readonly string[]): string | undefined =>
  words.find((word) => field !== undefined && field.toLowerCase().startsWith(word.toLowerCase()));

/** A product before its picture is looked up: `icon` is the name of its inventory icon. */
type Entry = Readonly<Omit<Sourced, "picture" | "finishes"> & { icon: string }>;

export const Minecraft = {
  /** The infoboxes the wiki keeps items and blocks under, and what a page with each is. */
  BOXES: [
    { type: "Item", template: "Infobox item" },
    { type: "Block", template: "Infobox block" },
  ],

  /**
   * The inventory icons an infobox shows, in order: its `invimage` fields,
   * or `title` when it names none. A row of dashes is a spacer, an icon of
   * one edition, marked ` BE` or ` JE`, repeats another, and a value with
   * markup in it, or a character a file title cannot hold, is not a name.
   */
  icons: (box: Infobox, title: string): readonly string[] => {
    const named = Object.entries(box)
      .filter(([name]) => /^invimage\d*$/.test(name))
      .sort(([a], [b]) => a.length - b.length || a.localeCompare(b))
      .map(([, value]) => value)
      .filter((value) => Minecraft.isName(value) && !value.startsWith("----") && !/ (BE|JE)\b/.test(value));
    const own = box["title"];

    return named.length > 0 ? named : [own !== undefined && Minecraft.isName(own) ? own : title];
  },

  /** Whether a field value is a plain name: one line without wiki markup or the characters a title cannot hold. */
  isName: (value: string): boolean => /^[^|{}[\]<>#\n]+$/.test(value),

  /** The one word a Yes/No field leads with, or nothing when it says more. */
  yesNo: (field: string | undefined): string | undefined => leading(field, ["Yes", "No"]),

  /** The most items of one stack, from a `stackable` field: `Yes (16)` is 16, a bare `Yes` is 64, `No` is 1. */
  stack: (field: string | undefined): string | undefined => {
    const count = /^Yes \((\d+)\)/.exec(field ?? "")?.[1];
    if (count !== undefined) return count;
    if (field === "Yes") return "64";
    return field?.startsWith("No") ? "1" : undefined;
  },

  /** The rarity a `rarity` field leads with, or Common when the box leaves it out, as the game does. */
  rarity: (field: string | undefined): string | undefined =>
    field === undefined ? "Common" : leading(field, ["Common", "Uncommon", "Rare", "Epic"]),

  /** The tool a block asks for, in sentence case; the wiki spells it several ways. */
  tool: (field: string | undefined): string | undefined => {
    if (field === undefined || !/^[a-z ]+$/i.test(field)) return undefined;
    const lower = field.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  },

  /** What a product is, from the box it comes from and the fields the box carries. */
  type: (box: Infobox, boxType: string): string => {
    if (boxType === "Block") return "Block";
    if ("hunger" in box) return "Food";
    if ("attackdamage" in box) return "Weapon";
    if (Object.keys(box).some((name) => name.startsWith("armor"))) return "Armor";
    if ("durability" in box) return "Tool";
    return "Item";
  },

  /** The properties of a product from `box`, one of the `boxType` boxes. */
  properties: (box: Infobox, boxType: string): Readonly<Record<string, string>> =>
    Sourced.properties({
      type: Minecraft.type(box, boxType),
      rarity: Minecraft.rarity(box["rarity"]),
      renewable: Minecraft.yesNo(box["renewable"]),
      "stack size": Minecraft.stack(box["stackable"]),
      tool: boxType === "Block" ? Minecraft.tool(box["tool"]) : undefined,
    }),

  /** The first paragraph of a page's extract, or nothing when the page has none. */
  blurb: (extract: string | undefined): string | undefined => {
    const paragraph = extract?.split("\n").find((line) => line.trim().length > 0)?.trim();
    return paragraph === undefined || paragraph.length === 0 ? undefined : paragraph;
  },

  /** Every item and block the wiki lists, with the address of its icon. */
  fetch: async (): Promise<readonly Sourced[]> => {
    const entries: Entry[] = [];
    const seen = new Set<string>();

    for (const shelf of Minecraft.BOXES) {
      // ponytail: a subpage documents an old or technical form of the thing, not a thing of its own.
      const titles = (await MediaWiki.list(API, "embeddedin", { eititle: `Template:${shelf.template}`, einamespace: "0", eilimit: "500" })).filter((title) => !title.includes("/"));
      const extracts = await Minecraft.extracts(titles);

      for (const [title, wikitext] of await MediaWiki.pages(API, titles)) {
        const box = MediaWiki.infobox(wikitext, shelf.template);
        if (box === undefined) continue;

        for (const icon of Minecraft.icons(box, title)) {
          if (seen.has(icon)) continue;
          seen.add(icon);
          entries.push({
            name: icon,
            description: Minecraft.blurb(extracts.get(title)) ?? `${icon}, from Minecraft.`,
            priceCents: 100 * faker.number.int({ min: 1, max: 30 }),
            properties: Minecraft.properties(box, shelf.type),
            icon,
          });
        }
      }
    }

    const fileTitle = (icon: string): string => `File:Invicon ${icon}.png`;
    const files = await MediaWiki.files(API, entries.map((entry) => fileTitle(entry.icon)));
    const skipped: string[] = [];

    // An item's icon is 16 pixels across and a block's render 32; a bigger render is brought down to a block's size, and a one-pixel file is a placeholder.
    const products = entries.flatMap(({ icon, ...entry }) => {
      const file = files.get(fileTitle(icon));
      if (file === undefined || file.width < 16) {
        skipped.push(icon);
        return [];
      }
      const unit = Math.max(1, Math.round(file.width / 32));
      return [{ ...entry, picture: { url: file.url, left: 0, top: 0, width: file.width, height: file.height, unit }, finishes: [] }];
    });
    if (skipped.length > 0) process.stderr.write(`Skipping ${skipped.length} icons the wiki has no file for: ${skipped.join(", ")}\n`);

    return products;
  },

  /** The plain-text introduction of every page in `titles`, keyed by title. */
  extracts: async (titles: readonly string[]): Promise<ReadonlyMap<string, string>> => {
    const found = new Map<string, string>();

    // The wiki hands out at most twenty extracts per call.
    for (const batch of MediaWiki.chunks(titles, 20)) {
      const result = await MediaWiki.call(API, responses.extracts, { action: "query", prop: "extracts", exintro: "1", explaintext: "1", exlimit: "20", redirects: "1", titles: batch.join("|") });
      for (const page of result.query.pages) if (page.extract !== undefined) found.set(page.title, page.extract);
    }

    return found;
  },
} as const;
