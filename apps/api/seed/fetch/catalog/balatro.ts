/**
 * Balatro's cards as products, read from the Balatro wiki through its
 * MediaWiki API: the fifty-two playing cards, and every Joker, Tarot card,
 * Spectral card, Voucher and Deck, each with its picture from the wiki.
 * Editions and enhancements, which the wiki lists as modifiers rather than
 * as cards, are drawn at random so the shelf carries some of each.
 */

import { faker } from "@faker-js/faker";
import { match } from "ts-pattern";
import { z } from "zod";
import { MediaWiki, type Infobox } from "./mediawiki.ts";
import type { Rgba, Shader } from "./raster.ts";
import { Sourced, type Finish } from "./sourced.ts";

const API = "https://balatrowiki.org/api.php";

const responses = {
  parsed: z.object({ parse: z.object({ wikitext: z.string() }) }),
  expanded: z.object({ expandtemplates: z.object({ wikitext: z.string() }) }),
};

/** A color as hue, saturation and lightness, each from 0 to 1, with alpha. */
type Hsla = Readonly<{ h: number; s: number; l: number; a: number }>;

const mod = (value: number, divisor: number): number => value - Math.floor(value / divisor) * divisor;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

const hueOf = (s: number, t: number, h: number): number => {
  const hs = mod(h, 1) * 6;
  if (hs < 1) return (t - s) * hs + s;
  if (hs < 3) return t;
  if (hs < 4) return (t - s) * (4 - hs) + s;
  return s;
};

/** `color` in the game's HSL, the way its shaders convert. */
const hsl = (color: Rgba): Hsla => {
  const low = Math.min(color.r, color.g, color.b);
  const high = Math.max(color.r, color.g, color.b);
  const delta = high - low;
  const sum = high + low;
  const l = 0.5 * sum;
  if (delta === 0) return { h: 0, s: 0, l, a: color.a };

  const h = high === color.r ? (color.g - color.b) / delta : high === color.g ? (color.b - color.r) / delta + 2 : (color.r - color.g) / delta + 4;
  return { h: mod(h / 6, 1), s: l < 0.5 ? delta / sum : delta / (2 - sum), l, a: color.a };
};

/** `color` back in RGB, the way the game's shaders convert. */
const rgb = (color: Hsla): Rgba => {
  if (color.s < 0.0001) return { r: color.l, g: color.l, b: color.l, a: color.a };
  const t = color.l < 0.5 ? color.s * color.l + color.l : -color.s * color.l + (color.s + color.l);
  const s = 2 * color.l - t;
  return { r: hueOf(s, t, color.h + 1 / 3), g: hueOf(s, t, color.h), b: hueOf(s, t, color.h - 1 / 3), a: color.a };
};

/** `over` laid on `base` by its own alpha; the base keeps its alpha, as the game draws a shader pass over the card. */
const laid = (base: Rgba, over: Rgba): Rgba => ({
  r: base.r * (1 - over.a) + clamp(over.r, 0, 1) * over.a,
  g: base.g * (1 - over.a) + clamp(over.g, 0, 1) * over.a,
  b: base.b * (1 - over.a) + clamp(over.b, 0, 1) * over.a,
  a: base.a,
});

/** The sprite cell of a card, in pixels of the art; the shaders quantize their noise to it. */
const CELL = { width: 71, height: 95 };

/** The art inside the cell, in pixels of the art; the cell's border is clear. */
const ART = { width: 69, height: 93 };

/** The frame the animated shaders are drawn at: the values the game feeds them, held still. */
const FRAME = { time: 0, foil: { r: 0.966, g: 2.644 }, holo: { x: 0.3, y: 12 }, polychrome: { x: 1.5, y: 1 } };

/** The game's drifting noise at (`x`, `y`), spread over `scale` and moved along by `t`. */
const field = (x: number, y: number, scale: number, t: number): number => {
  const cx = (Math.floor(x * CELL.width) / CELL.width - 0.5) * scale;
  const cy = (Math.floor(y * CELL.height) / CELL.height - 0.5) * scale;
  const part1 = { x: cx + 50 * Math.sin(-t / 143.634), y: cy + 50 * Math.cos(-t / 99.4324) };
  const part2 = { x: cx + 50 * Math.cos(t / 53.1532), y: cy + 50 * Math.cos(t / 61.4532) };
  const part3 = { x: cx + 50 * Math.sin(-t / 87.53218), y: cy + 50 * Math.sin(-t / 49) };

  return (
    (1 +
      (Math.cos(Math.hypot(part1.x, part1.y) / 19.483) +
        Math.sin(Math.hypot(part2.x, part2.y) / 33.155) * Math.cos(part2.y / 15.73) +
        Math.cos(Math.hypot(part3.x, part3.y) / 27.193) * Math.sin(part3.x / 21.92))) /
    2
  );
};

/** The game's foil shader: rings and streaks of light, tinted blue, over the card. */
const foil: Shader = ({ x, y }, tex) => {
  const { r: fr, g: fg } = FRAME.foil;
  const ax = ((x - 0.5) * CELL.width) / CELL.height;
  const ay = y - 0.5;
  const low = Math.min(tex.r, tex.g, tex.b);
  const high = Math.max(tex.r, tex.g, tex.b);
  const delta = Math.min(high, Math.max(0.5, 1 - low));
  const length = Math.hypot(ax, ay);

  const fac = clamp(2 * Math.sin(90 * length + fr * 2 + 3 * (1 + 0.8 * Math.cos(113.1121 * length - fr * 3.121))) - 1 - Math.max(5 - 90 * length, 0), 0, 1);
  const rotater = { x: Math.cos(fr * 0.1221), y: Math.sin(fr * 0.3512) };
  const angle = length === 0 ? 0 : (rotater.x * ax + rotater.y * ay) / (Math.hypot(rotater.x, rotater.y) * length);
  const fac2 = clamp(5 * Math.cos(fg * 0.3 + angle * 3.14 * (2.2 + 0.9 * Math.sin(fr * 1.65 + 0.2 * fg))) - 4 - Math.max(2 - 20 * length, 0), 0, 1);
  const fac3 = 0.3 * clamp(2 * Math.sin(fr * 5 + x * 3 + 3 * (1 + 0.5 * Math.cos(fr * 7))) - 1, -1, 1);
  const fac4 = 0.3 * clamp(2 * Math.sin(fr * 6.66 + y * 3.8 + 3 * (1 + 0.5 * Math.cos(fr * 3.414))) - 1, -1, 1);
  const maxfac = Math.max(Math.max(fac, fac2, fac3, fac4, 0) + 2.2 * (fac + fac2 + fac3 + fac4), 0);

  return laid(tex, {
    r: tex.r - delta + delta * maxfac * 0.3,
    g: tex.g - delta + delta * maxfac * 0.3,
    b: tex.b + delta * maxfac * 1.9,
    a: Math.min(tex.a, 0.3 * tex.a + 0.9 * Math.min(0.5, maxfac * 0.1)),
  });
};

/** The alpha the game's holographic, polychrome and negative passes draw with: a translucent pixel is drawn fainter. */
const passAlpha = (a: number): number => (a < 0.7 ? a / 3 : a);

/** The game's holographic shader: the hues turned by drifting noise, over a grid of light. */
const holo: Shader = ({ x, y }, tex) => {
  const color = hsl({ r: 0.5 * tex.r, g: 0.5 * tex.g, b: 0.5 * tex.b + 0.5, a: tex.a });
  const res = 0.5 + 0.5 * Math.cos(FRAME.holo.x * 2.612 + (field(x, y, 250, FRAME.holo.y * 7.221 + FRAME.time) - 0.5) * 3.14);
  const low = Math.min(tex.r, tex.g, tex.b);
  const high = Math.max(tex.r, tex.g, tex.b);
  const delta = 0.2 + 0.3 * (high - low) + 0.1 * high;
  const grid = 0.79;
  const fac =
    0.5 *
    Math.max(
      Math.max(0, 7 * Math.abs(Math.cos(x * grid * 20)) - 6),
      Math.max(0, 7 * Math.cos(y * grid * 45 + x * grid * 20) - 6),
      Math.max(0, 7 * Math.cos(y * grid * 45 - x * grid * 20) - 6),
    );
  const turned = rgb({ h: color.h + res + fac, s: color.s * 1.3, l: color.l * 0.6 + 0.4, a: tex.a });

  return laid(tex, {
    r: (1 - delta) * tex.r + delta * turned.r * 0.9,
    g: (1 - delta) * tex.g + delta * turned.g * 0.8,
    b: (1 - delta) * tex.b + delta * turned.b * 1.2,
    a: passAlpha(tex.a),
  });
};

/** The game's polychrome shader: every hue turned by drifting noise, saturated. */
const polychrome: Shader = ({ x, y }, tex) => {
  const delta = Math.max(tex.r, tex.g, tex.b) - Math.min(tex.r, tex.g, tex.b);
  const saturation = 1 - Math.max(0, 0.05 * (1.1 - delta));
  const color = hsl({ r: tex.r * saturation, g: tex.g * saturation, b: tex.b, a: tex.a });
  const res = 0.5 + 0.5 * Math.cos(FRAME.polychrome.x * 2.612 + (field(x, y, 50, FRAME.polychrome.y * 2.221 + FRAME.time) - 0.5) * 3.14);
  const turned = rgb({ h: color.h + res + FRAME.polychrome.y * 0.04, s: Math.min(0.6, color.s + 0.5), l: color.l, a: tex.a });

  return laid(tex, { ...turned, a: passAlpha(tex.a) });
};

/** The game's negative shader: lightness inverted, the hue turned, and a gray-green cast added. */
const negative: Shader = (_uv, tex) => {
  const color = hsl(tex);
  const turned = rgb({ h: -color.h + 0.2, s: color.s, l: 1 - color.l, a: tex.a });

  return laid(tex, { r: turned.r + 0.8 * (79 / 255), g: turned.g + 0.8 * (99 / 255), b: turned.b + 0.8 * (103 / 255), a: passAlpha(tex.a) });
};

/**
 * The game's sheet of card faces and backs, at two pixels per pixel of the
 * art, from a project on GitHub that carries it; the wiki only has the faces
 * drawn under an ace. One cell per card.
 */
const ENHANCERS = "https://raw.githubusercontent.com/Pengu12345/PenguWare4/34f5c882ae17122f3cd21cdf7c6fea7f7ec0f72f/game/minigames/min_balatro/sprites/Enhancers.png";

/** The face of each enhancement on the sheet, as a column and row of cells. */
const FACES: Readonly<Record<string, Readonly<{ column: number; row: number }>>> = {
  Bonus: { column: 1, row: 1 },
  Mult: { column: 2, row: 1 },
  Wild: { column: 3, row: 1 },
  Lucky: { column: 4, row: 1 },
  Glass: { column: 5, row: 1 },
  Steel: { column: 6, row: 1 },
  Stone: { column: 5, row: 0 },
  Gold: { column: 6, row: 0 },
};

/** The finish of the enhancement `name`: its face under the card's rank and suit. A stone card shows neither. */
const face = (name: string): readonly Finish[] => {
  const cell = FACES[name];
  if (cell === undefined) return [];
  return [
    {
      _tag: "Face",
      picture: { url: ENHANCERS, left: cell.column * CELL.width * 2, top: cell.row * CELL.height * 2, width: CELL.width * 2, height: CELL.height * 2, unit: 2 },
      ink: name === "Stone" ? () => false : (color) => Balatro.ink(color),
    },
  ];
};

/** How each edition and enhancement is drawn on a card that carries it. */
const FINISHES: Readonly<Record<string, readonly Finish[]>> = {
  Foil: [{ _tag: "Shader", shade: foil }],
  Holographic: [{ _tag: "Shader", shade: holo }],
  Polychrome: [{ _tag: "Shader", shade: polychrome }],
  Negative: [{ _tag: "Shader", shade: negative }],
  ...Object.fromEntries(Object.keys(FACES).map((name) => [name, face(name)])),
};

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


  /** The pixels of the art on a playing card's face, as the wiki draws it: the white face and its gray edge are not. */
  ink: (color: Rgba): boolean => {
    const bytes = [color.r, color.g, color.b].map((channel) => Math.round(channel * 255));
    return color.a > 0 && !["255,255,255", "192,200,214"].includes(bytes.join(","));
  },

  /** The edition shaders, by the edition's name, for a look at one pixel. */
  SHADERS: { Foil: foil, Holographic: holo, Polychrome: polychrome, Negative: negative } satisfies Readonly<Record<string, Shader>>,

  /** The finishes of a card with `properties`: its enhancement's first, then its edition's. */
  finishes: (properties: Readonly<Record<string, string>>): readonly Finish[] =>
    [properties["enhancement"], properties["edition"]].flatMap((value) => (value === undefined ? [] : (FINISHES[value] ?? []))),

  /** The names in the wiki's Lua data module of Jokers. */
  jokerNames: (lua: string): readonly string[] => [...lua.matchAll(/\bname = "([^"]+)"/g)].map((found) => found[1] ?? ""),

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
    const lua = (await MediaWiki.call(API, responses.parsed, { action: "parse", page: "Module:Jokers/data", prop: "wikitext" })).parse.wikitext;
    const boxes: { type: string; box: Infobox }[] = [];

    for (const shelf of [{ type: "Joker", titles: Balatro.jokerNames(lua), template: "Joker info" }, ...Balatro.SHELVES]) {
      const titles =
        "titles" in shelf
          ? shelf.titles
          : await MediaWiki.list(API, "categorymembers", { cmtitle: `Category:${shelf.category}`, cmnamespace: "0", cmlimit: "500" });

      for (const [title, wikitext] of await MediaWiki.pages(API, titles)) {
        const box = MediaWiki.infobox(wikitext, shelf.template);
        // The Decks category also files the challenge pages, which carry the same box.
        if (box !== undefined && (shelf.type !== "Deck" || title.endsWith(" Deck"))) boxes.push({ type: shelf.type, box });
      }
    }

    // Expanded in a few calls, so the readable text carries the words the templates add.
    const effects: string[] = [];
    for (const batch of MediaWiki.chunks(boxes.map(({ box }) => box["effect"] ?? box["limit"] ?? ""), 40)) {
      const text = (await MediaWiki.call(API, responses.expanded, { action: "expandtemplates", prop: "wikitext", text: batch.join("\n@@@\n") })).expandtemplates.wikitext;
      effects.push(...text.split("\n@@@\n").map(Balatro.plain));
    }
    if (effects.length !== boxes.length) throw new Error(`asked for ${boxes.length} effects, the wiki expanded ${effects.length}`);

    const cards = [...Balatro.playingCards(), ...boxes.map(({ type, box }, index) => Balatro.card(type, box, effects[index] ?? ""))];

    // The wiki names a file with spaces and a capital, whatever the box wrote.
    const fileTitle = (image: string): string => `File:${image.replace(/_/g, " ").replace(/^./, (first) => first.toUpperCase())}`;
    const files = await MediaWiki.files(API, cards.map((card) => fileTitle(card.image)));

    // The wiki draws a card on its cell, at its own number of pixels per pixel, and some renders line the cell's border with a soft outline; the art inside is what is kept.
    return cards.map(({ image, ...card }) => {
      const file = files.get(fileTitle(image));
      if (file === undefined) throw new Error(`the wiki has no picture ${image} for ${card.name}`);
      const unit = Math.round(file.width / CELL.width);
      return {
        ...card,
        picture: { url: file.url, left: Math.floor((file.width - ART.width * unit) / 2), top: Math.floor((file.height - ART.height * unit) / 2), width: ART.width * unit, height: ART.height * unit, unit },
      };
    });
  },
} as const;
