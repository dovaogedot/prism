/**
 * Balatro's cards as products, read from the Balatro wiki through its
 * MediaWiki API: the fifty-two playing cards, and every Joker, Tarot card,
 * Spectral card, Voucher and Deck, each with its picture from the wiki.
 * Editions and enhancements, which the wiki lists as modifiers rather than
 * as cards, are drawn at random so the shelf carries some of each.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { faker } from "@faker-js/faker";
import { match } from "ts-pattern";
import { z } from "zod";
import { Sourced, type Finish } from "./sourced.ts";

const API = "https://balatrowiki.org/api.php";

const responses = {
  members: z.object({ query: z.object({ categorymembers: z.array(z.object({ title: z.string() })) }) }),
  parsed: z.object({ parse: z.object({ wikitext: z.string() }) }),
  pages: z.object({
    query: z.object({
      pages: z.array(
        z.object({
          title: z.string(),
          revisions: z.array(z.object({ slots: z.object({ main: z.object({ content: z.string() }) }) })).optional(),
        }),
      ),
    }),
  }),
  images: z.object({
    query: z.object({
      pages: z.array(z.object({ title: z.string(), imageinfo: z.array(z.object({ url: z.string() })).optional() })),
    }),
  }),
  expanded: z.object({ expandtemplates: z.object({ wikitext: z.string() }) }),
};

/** One call to the wiki's API, read through `schema`. */
const call = async <T>(schema: z.ZodType<T>, params: Readonly<Record<string, string>>): Promise<T> => {
  await sleep(200);
  const response = await fetch(API, {
    method: "POST",
    headers: { "user-agent": Sourced.USER_AGENT },
    body: new URLSearchParams({ ...params, format: "json", formatversion: "2" }),
  });
  if (!response.ok) throw new Error(`${API} answered ${response.status}`);
  return schema.parse(await response.json());
};

/** `items` in runs of at most `size`. */
const chunks = <T>(items: readonly T[], size: number): readonly (readonly T[])[] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

/** The wikitext of every page named in `titles`, keyed by title. */
const pages = async (titles: readonly string[]): Promise<ReadonlyMap<string, string>> => {
  const found = new Map<string, string>();

  for (const batch of chunks(titles, 50)) {
    // The data module names a few Jokers by a redirect, which the wiki follows.
    const result = await call(responses.pages, { action: "query", prop: "revisions", rvprop: "content", rvslots: "main", redirects: "1", titles: batch.join("|") });
    for (const page of result.query.pages) {
      const content = page.revisions?.[0]?.slots.main.content;
      if (content !== undefined) found.set(page.title, content);
    }
  }

  return found;
};

const svgOf = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`;

/** A color multiplied into the card, so its white face takes the color and its ink stays. */
const tint = (color: string): Finish => ({
  _tag: "Layer",
  blend: "multiply",
  svg: (width, height) => svgOf(width, height, `<rect width="100%" height="100%" fill="${color}"/>`),
});

/** A diagonal run of colors multiplied into the card. */
const sheen = (stops: readonly string[]): Finish => ({
  _tag: "Layer",
  blend: "multiply",
  svg: (width, height) =>
    svgOf(
      width,
      height,
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops
        .map((color, index) => `<stop offset="${index / (stops.length - 1)}" stop-color="${color}"/>`)
        .join("")}</linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/>`,
    ),
});

/** Two diagonal bands of light, as a glossy card catches it. */
const shine: Finish = {
  _tag: "Layer",
  blend: "screen",
  svg: (width, height) =>
    svgOf(
      width,
      height,
      `<polygon points="${0.15 * width},0 ${0.4 * width},0 ${0.1 * width},${height} 0,${height}" fill="#fff" fill-opacity="0.35"/>` +
        `<polygon points="${0.6 * width},0 ${0.75 * width},0 ${0.45 * width},${height} ${0.3 * width},${height}" fill="#fff" fill-opacity="0.25"/>`,
    ),
};

/** How each edition and enhancement is drawn, statically, on a card that carries it. */
const FINISHES: Readonly<Record<string, readonly Finish[]>> = {
  Foil: [sheen(["#c9e6ff", "#ffffff", "#b5d8ff"]), shine],
  Holographic: [sheen(["#ffc2ec", "#dcc6ff", "#c2f0ff"]), shine],
  Polychrome: [sheen(["#ffb3b3", "#fff0a8", "#b8f5b8", "#b3ecff", "#d5b8ff"]), shine],
  Negative: [{ _tag: "Negate" }],
  Bonus: [tint("#cfe0ff")],
  Mult: [tint("#ffc9c9")],
  Wild: [sheen(["#cfcfe6", "#f5bcbc", "#bcd6f0", "#f7d8b0"])],
  Glass: [tint("#e3f4ff"), shine],
  Steel: [tint("#d9dde3"), shine],
  Stone: [tint("#b8bcc4")],
  Gold: [tint("#f3d27c"), shine],
  Lucky: [tint("#f3ecd2")],
};

/** The parameters of one infobox, keyed by name. */
export type Infobox = Readonly<Record<string, string>>;

/** A card before its picture is looked up: `image` is the wiki's file name. */
export type Card = Readonly<Omit<Sourced, "picture"> & { image: string }>;

/** A list of the wiki and the infobox template its pages carry. */
type Shelf = Readonly<{ type: string; category: string; template: string }>;

export const Balatro = {
  RANKS: ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"],
  SUITS: ["Spades", "Hearts", "Clubs", "Diamonds"],

  /** How often each edition is drawn; the base edition is the common case. */
  EDITIONS: [
    { value: "Base", weight: 6 },
    { value: "Foil", weight: 1 },
    { value: "Holographic", weight: 1 },
    { value: "Polychrome", weight: 1 },
    { value: "Negative", weight: 1 },
  ],

  /** How often each enhancement is drawn for a playing card; most carry none. */
  ENHANCEMENTS: [
    { value: "None", weight: 8 },
    { value: "Bonus", weight: 1 },
    { value: "Mult", weight: 1 },
    { value: "Wild", weight: 1 },
    { value: "Glass", weight: 1 },
    { value: "Steel", weight: 1 },
    { value: "Stone", weight: 1 },
    { value: "Gold", weight: 1 },
    { value: "Lucky", weight: 1 },
  ],

  /** The lists the wiki keeps beside the Jokers, each read through its own infobox. */
  SHELVES: [
    { type: "Tarot", category: "Tarot Cards", template: "Consumable info" },
    { type: "Spectral", category: "Spectral Cards", template: "Consumable info" },
    { type: "Voucher", category: "Vouchers", template: "Voucher info" },
    { type: "Deck", category: "Decks", template: "Deck info" },
  ] satisfies readonly Shelf[],


  /** The finishes of a card with `properties`: its enhancement's first, then its edition's. */
  finishes: (properties: Readonly<Record<string, string>>): readonly Finish[] =>
    [properties["enhancement"], properties["edition"]].flatMap((value) => (value === undefined ? [] : (FINISHES[value] ?? []))),

  /** The names in the wiki's Lua data module of Jokers. */
  jokerNames: (lua: string): readonly string[] => [...lua.matchAll(/\bname = "([^"]+)"/g)].map((found) => found[1] ?? ""),

  /**
   * The parameters of the `{{<template>` infobox in `wikitext`, or undefined
   * when the page carries none. A parameter starts a line with `|`.
   */
  infobox: (wikitext: string, template: string): Infobox | undefined => {
    const start = wikitext.indexOf(`{{${template}`);
    if (start < 0) return undefined;

    let depth = 0;
    let index = start;
    while (index < wikitext.length) {
      if (wikitext.startsWith("{{", index)) {
        depth += 1;
        index += 2;
      } else if (wikitext.startsWith("}}", index)) {
        depth -= 1;
        index += 2;
        if (depth === 0) break;
      } else index += 1;
    }

    const fields: Record<string, string> = {};
    for (const line of wikitext.slice(start + 2 + template.length, index - 2).split(/\n\s*\|/)) {
      const equals = line.indexOf("=");
      if (equals < 0) continue;
      fields[line.slice(0, equals).trim()] = line.slice(equals + 1).replace(/<!--[\s\S]*?-->/g, "").trim();
    }

    return fields;
  },

  /** The readable text of expanded wikitext: links and tags gone, their labels kept. */
  plain: (expanded: string): string =>
    expanded
      .replace(/<span class="metadata-dpl[^"]*"[^>]*>[\s\S]*?<\/span>/g, "")
      .replace(/\[\[File:[^\]]*\]\]/g, "")
      .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
      .replace(/\[\[([^\]]*)\]\]/g, "$1")
      .replace(/<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/'{2,}/g, "")
      .replace(/\s+/g, " ")
      .trim(),

  /** The whole dollars at the start of a wiki cost field, or `fallback` when it has none. */
  dollars: (field: string | undefined, fallback: number): number => {
    const found = /^\d+/.exec(field ?? "");
    return found === null ? fallback : Number(found[0]);
  },

  /** The fifty-two playing cards, each with a random edition and enhancement. */
  playingCards: (): readonly Card[] =>
    Balatro.SUITS.flatMap((suit) =>
      Balatro.RANKS.map((rank) => {
        const name = `${rank} of ${suit}`;
        const chips = match(rank)
          .with("Ace", () => 11)
          .with("Jack", "Queen", "King", () => 10)
          .otherwise(() => Number(rank));
        const kind = match(rank)
          .with("Ace", () => "Ace")
          .with("Jack", "Queen", "King", () => "Face card")
          .otherwise(() => "Number card");

        const properties = {
          type: "Playing card",
          rank,
          suit,
          kind,
          edition: faker.helpers.weightedArrayElement(Balatro.EDITIONS),
          enhancement: faker.helpers.weightedArrayElement(Balatro.ENHANCEMENTS),
        };

        return {
          name,
          description: `The ${name} from the standard 52-card deck, worth ${chips} chips when scored.`,
          priceCents: 100 * faker.number.int({ min: 1, max: 5 }),
          properties,
          finishes: Balatro.finishes(properties),
          image: `${name}.png`,
        };
      }),
    ),

  /** A card of `type` from its infobox, with `effect` already made readable. Throws when the box names no title or image. */
  card: (type: string, box: Infobox, effect: string): Card => {
    const name = box["title"];
    const image = box["image"];
    if (name === undefined || image === undefined) throw new Error(`a ${type} infobox lacks a title or an image: ${JSON.stringify(box)}`);

    const properties = match(type)
      .with("Joker", () =>
        Sourced.properties({ type, rarity: box["rarity"], effect: box["type"], activation: box["activation"], edition: faker.helpers.weightedArrayElement(Balatro.EDITIONS) }),
      )
      .with("Tarot", "Spectral", () => ({
        type,
        edition: faker.helpers.weightedArrayElement([
          { value: "Base", weight: 4 },
          { value: "Negative", weight: 1 },
        ]),
      }))
      .with("Voucher", () => Sourced.properties({ type, tier: box["type"] }))
      .otherwise(() => ({ type }));

    return {
      name,
      description: effect,
      priceCents: 100 * Balatro.dollars(box["buyprice"], type === "Voucher" ? 10 : faker.number.int({ min: 10, max: 30 })),
      properties,
      finishes: Balatro.finishes(properties),
      image,
    };
  },

  /** Every card the wiki lists, with the address of its picture. */
  fetch: async (): Promise<readonly Sourced[]> => {
    const lua = (await call(responses.parsed, { action: "parse", page: "Module:Jokers/data", prop: "wikitext" })).parse.wikitext;
    const boxes: { type: string; box: Infobox }[] = [];

    for (const shelf of [{ type: "Joker", titles: Balatro.jokerNames(lua), template: "Joker info" }, ...Balatro.SHELVES]) {
      const titles =
        "titles" in shelf
          ? shelf.titles
          : (await call(responses.members, { action: "query", list: "categorymembers", cmtitle: `Category:${shelf.category}`, cmnamespace: "0", cmlimit: "500" })).query.categorymembers.map((member) => member.title);

      for (const [title, wikitext] of await pages(titles)) {
        const box = Balatro.infobox(wikitext, shelf.template);
        // The Decks category also files the challenge pages, which carry the same box.
        if (box !== undefined && (shelf.type !== "Deck" || title.endsWith(" Deck"))) boxes.push({ type: shelf.type, box });
      }
    }

    // Expanded in a few calls, so the readable text carries the words the templates add.
    const effects: string[] = [];
    for (const batch of chunks(boxes.map(({ box }) => box["effect"] ?? box["limit"] ?? ""), 40)) {
      const text = (await call(responses.expanded, { action: "expandtemplates", prop: "wikitext", text: batch.join("\n@@@\n") })).expandtemplates.wikitext;
      effects.push(...text.split("\n@@@\n").map(Balatro.plain));
    }
    if (effects.length !== boxes.length) throw new Error(`asked for ${boxes.length} effects, the wiki expanded ${effects.length}`);

    const cards = [...Balatro.playingCards(), ...boxes.map(({ type, box }, index) => Balatro.card(type, box, effects[index] ?? ""))];

    // The wiki names a file with spaces and a capital, whatever the box wrote.
    const fileTitle = (image: string): string => `File:${image.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase())}`;
    const urls = new Map<string, string>();
    for (const batch of chunks(cards.map((card) => fileTitle(card.image)), 50)) {
      const result = await call(responses.images, { action: "query", prop: "imageinfo", iiprop: "url", titles: batch.join("|") });
      for (const page of result.query.pages) {
        const url = page.imageinfo?.[0]?.url;
        if (url !== undefined) urls.set(page.title, url);
      }
    }

    return cards.map(({ image, ...card }) => {
      const url = urls.get(fileTitle(image));
      if (url === undefined) throw new Error(`the wiki has no picture ${image} for ${card.name}`);
      return { ...card, picture: { _tag: "File", url } };
    });
  },
} as const;
