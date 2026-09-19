/**
 * The Binding of Isaac's items, trinkets and consumables as products, read
 * from tboi.com, whose one page lists them all and draws each from a sprite
 * sheet through a CSS class.
 */

import { faker } from "@faker-js/faker";
import { Sourced, type Picture } from "./sourced.ts";

const SITE = "https://www.tboi.com/";

/** One CSS rule: its selector and its declarations as written. */
export type CssRule = Readonly<{ selector: string; declarations: string }>;

/** One entry of the page, under the heading above it. */
export type Entry = Readonly<{
  classes: readonly string[];
  section: string;
  name: string;
  quote: string;
  paragraphs: readonly string[];
  quality: string | undefined;
  type: string;
  recharge: string | undefined;
  tags: readonly string[];
  card: boolean;
}>;

export const Isaac = {
  /** Every rule of a stylesheet, in order. */
  rules: (css: string): readonly CssRule[] =>
    [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((found) => ({ selector: (found[1] ?? "").trim(), declarations: found[2] ?? "" })),

  /** The text of a fragment of HTML: tags gone, entities decoded, whitespace collapsed. */
  text: (html: string): string =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&#39;|&rsquo;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim(),

  /** The entries of the page, each under the `<h2>` above it. */
  entries: (html: string): readonly Entry[] =>
    html
      .split("<h2>")
      .slice(1)
      .flatMap((chunk) => {
        const section = Isaac.text(chunk.slice(0, chunk.indexOf("</h2>")));
        return [...chunk.matchAll(/<li class="textbox"[^>]*>([\s\S]*?)<\/li>/g)].map((found) => Isaac.entry(section, found[1] ?? ""));
      }),

  /** One entry from the inside of its list item. */
  entry: (section: string, item: string): Entry => {
    const field = (pattern: RegExp): string | undefined => {
      const found = pattern.exec(item)?.[1];
      return found === undefined ? undefined : Isaac.text(found);
    };
    const words = (text: string | undefined, separator: string): readonly string[] =>
      (text ?? "")
        .split(separator)
        .map((word) => word.trim())
        .filter((word) => word.length > 0);

    return {
      classes: words(field(/class="([^"]*)"/), " "),
      section,
      name: field(/class="item-title">([\s\S]*?)<\/p>/) ?? "",
      quote: (field(/class="pickup">([\s\S]*?)<\/p>/) ?? "").replace(/^"|"$/g, ""),
      // The unlabeled paragraphs; the labeled ones are read as fields below.
      paragraphs: [...item.matchAll(/<p>([\s\S]*?)<\/p>/g)]
        .map((found) => Isaac.text(found[1] ?? ""))
        .filter((paragraph) => paragraph.length > 0 && !/^(Type|Item Pool|Recharge Time):/.test(paragraph)),
      quality: field(/Quality: (\d)/),
      type: field(/Type: ([^<]*)/) ?? "",
      recharge: field(/Recharge Time: ([^<]*)/),
      tags: words(field(/class="tags">([\s\S]*?)<\/p>/), ","),
      card: item.includes("CardID:"),
    };
  },

  /**
   * Where on which sheet the sprite of an element with `classes` is, or
   * undefined when the stylesheet places none. One class names the sheet,
   * through a rule with a background image; another names the slice,
   * through a rule with a background position that may also size it.
   */
  sprite: (rules: readonly CssRule[], classes: readonly string[]): Picture | undefined => {
    const url = (rule: CssRule | undefined): string | undefined => /background[^;]*url\(["']?([^"')]+)/.exec(rule?.declarations ?? "")?.[1];
    const sheet = classes.map((cls) => rules.find((rule) => rule.selector.endsWith(`.${cls}`) && url(rule) !== undefined)).find((rule) => rule !== undefined);
    if (sheet === undefined) return undefined;

    const placed = rules.filter(
      (rule) => rule.declarations.includes("background-position") && classes.some((cls) => rule.selector.endsWith(`.${cls}`) && !sheet.selector.endsWith(`.${cls}`)),
    );
    const slice = placed.find((rule) => rule.selector.includes(sheet.selector.slice(sheet.selector.lastIndexOf(".")))) ?? placed[0];
    const position = /background-position:\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?/.exec(slice?.declarations ?? "");
    const address = url(slice) ?? url(sheet);
    if (slice === undefined || position === null || address === undefined) return undefined;

    const size = (side: string): number =>
      Number(new RegExp(`${side}:(\\d+)px`).exec(slice.declarations)?.[1] ?? new RegExp(`${side}:(\\d+)px`).exec(sheet.declarations)?.[1] ?? 50);

    return { url: new URL(address, `${SITE}assets/`).href, left: 0 - Number(position[1]), top: 0 - Number(position[2]), width: size("width"), height: size("height"), unit: 1 };
  },

  /** What an entry is, as the shop's type property names it. */
  kind: (entry: Entry): string => {
    if (entry.section.includes("Trinket")) return "Trinket";
    if (entry.section.includes("Item")) return entry.type.startsWith("Active") ? "Active item" : "Passive item";
    if (entry.tags.includes("tarot")) return entry.name.endsWith("?") ? "Reversed tarot card" : "Tarot card";
    if (entry.name.includes("Rune")) return "Rune";
    if (entry.name.startsWith("Soul of")) return "Soul";
    if (entry.name.includes("Pill")) return "Pill";
    return entry.card ? "Card" : "Pickup";
  },

  /** An entry as a product, drawn from `picture`. */
  product: (entry: Entry, picture: Picture): Sourced => ({
    name: entry.name,
    description: [entry.quote.replace(/[^.!?]$/, "$&."), ...entry.paragraphs].join(" ").trim(),
    priceCents: 100 * faker.number.int({ min: 1, max: 30 }),
    properties: Sourced.properties({
      type: Isaac.kind(entry),
      quality: entry.quality,
      recharge: entry.recharge,
      expansion: /^(.+?) (?:Items|Trinkets)\b/.exec(entry.section)?.[1],
    }),
    picture,
    finishes: [],
  }),

  /** Every entry of the page that the stylesheet draws, as a product. */
  fetch: async (): Promise<readonly Sourced[]> => {
    const html = await (await Sourced.get(`${SITE}all-items`)).text();
    const rules = Isaac.rules(await (await Sourced.get(`${SITE}assets/main.css`)).text());

    return Isaac.entries(html).flatMap((entry) => {
      const picture = Isaac.sprite(rules, entry.classes);
      if (picture === undefined) {
        process.stderr.write(`Skipping ${entry.name}: the stylesheet does not draw it.\n`);
        return [];
      }
      return [Isaac.product(entry, picture)];
    });
  },
} as const;
