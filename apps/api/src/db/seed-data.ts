/**
 * The catalogue's vocabulary.
 *
 * Colours are generated rather than listed: each leaf category owns an arc of
 * the hue circle and a set of words, and the seed combines them. That gives a
 * few hundred distinct products from a page of data, and every product still
 * has a name someone would plausibly put on a vial.
 */

import type { Finish } from "@hue/shared";

export type CategorySeed = Readonly<{
  slug: string;
  name: string;
  description: string;
  children: readonly LeafCategorySeed[];
}>;

export type LeafCategorySeed = Readonly<{
  slug: string;
  name: string;
  description: string;
  /** Inclusive hue arc in degrees; may wrap through 0. */
  hue: Readonly<{ from: number; to: number }>;
  saturation: Readonly<{ from: number; to: number }>;
  lightness: Readonly<{ from: number; to: number }>;
  adjectives: readonly string[];
  nouns: readonly string[];
}>;

export const BRANDS = [
  {
    slug: "chroma-labs",
    name: "Chroma Labs",
    description:
      "Founded by two physicists who could not agree on what teal was. They still cannot, but they ship on time.",
  },
  {
    slug: "vantablack-industries",
    name: "Vantablack Industries",
    description:
      "Specialists in the darker end of the catalogue. Their showroom has never been successfully photographed.",
  },
  {
    slug: "cyan-and-sons",
    name: "Cyan & Sons",
    description:
      "A family firm since 1889. The sons have branched into magenta, which caused a rift.",
  },
  {
    slug: "the-pigment-exchange",
    name: "The Pigment Exchange",
    description:
      "A trading floor where hues are bought and sold by the degree. Volatile around the oranges.",
  },
  {
    slug: "munsell-and-daughters",
    name: "Munsell & Daughters",
    description:
      "Rigorous, systematic, and quietly furious about how everyone else numbers their colours.",
  },
  {
    slug: "bauhaus-bros",
    name: "Bauhaus Bros",
    description:
      "Three primaries, three shapes, no discussion. Their catalogue is one page and they are proud of it.",
  },
  {
    slug: "hexadecimal-holdings",
    name: "Hexadecimal Holdings",
    description:
      "Sells colours strictly by their hex value and considers names a marketing affectation.",
  },
  {
    slug: "perceptual-uniform",
    name: "Perceptual Uniform Ltd",
    description:
      "Every colour is exactly as far from its neighbour as it looks. This took eleven years.",
  },
] as const;

export const FINISHES: readonly Finish[] = [
  "matte",
  "gloss",
  "iridescent",
  "fluorescent",
];

/** How the colour behaves once it is out of the vial. */
export const FINISH_NOTES: Record<Finish, string> = {
  matte: "Absorbs light politely and returns none of it.",
  gloss: "Reflective enough to check your parting in.",
  iridescent: "Changes its mind depending on where you stand.",
  fluorescent: "Legal in most jurisdictions. Check locally.",
};

const CEREMONIAL = [
  "Screaming",
  "Municipal",
  "Unlicensed",
  "Tactical",
  "Regrettable",
  "Emergency",
  "Operatic",
  "Persuasive",
  "Ceremonial",
  "Contraband",
  "Provisional",
  "Notarised",
];

export const CATEGORIES: readonly CategorySeed[] = [
  {
    slug: "reds-and-pinks",
    name: "Reds & Pinks",
    description: "Loud, arterial, or apologetic. There is no middle ground here.",
    children: [
      {
        slug: "crimsons",
        name: "Crimsons",
        description: "The serious reds. Wear a tie.",
        hue: { from: 348, to: 10 },
        saturation: { from: 62, to: 96 },
        lightness: { from: 28, to: 54 },
        adjectives: [...CEREMONIAL, "Cardinal", "Imperial"],
        nouns: ["Crimson", "Scarlet", "Vermilion", "Carmine", "Garnet", "Claret"],
      },
      {
        slug: "blushes",
        name: "Blushes",
        description: "Reds that have been asked a direct question.",
        hue: { from: 330, to: 355 },
        saturation: { from: 30, to: 72 },
        lightness: { from: 62, to: 88 },
        adjectives: ["Faint", "Sheepish", "Debutante", "Powdered", "Reluctant", "Sunday"],
        nouns: ["Blush", "Rosé", "Peony", "Fondant", "Camellia", "Whisper"],
      },
    ],
  },
  {
    slug: "oranges-and-browns",
    name: "Oranges & Browns",
    description: "Rust, terracotta, and the colour of a good afternoon.",
    children: [
      {
        slug: "rusts",
        name: "Rusts",
        description: "Oxidised, weathered, faintly agricultural.",
        hue: { from: 12, to: 32 },
        saturation: { from: 48, to: 88 },
        lightness: { from: 34, to: 56 },
        adjectives: [...CEREMONIAL, "Corrugated", "Abandoned"],
        nouns: ["Rust", "Terracotta", "Ochre", "Paprika", "Tangerine", "Ember"],
      },
      {
        slug: "earths",
        name: "Earths",
        description: "Browns for people who say 'browns' without flinching.",
        hue: { from: 20, to: 40 },
        saturation: { from: 18, to: 52 },
        lightness: { from: 20, to: 46 },
        adjectives: ["Ploughed", "Peat", "Reclaimed", "Honest", "Weekday", "Cellar"],
        nouns: ["Umber", "Sienna", "Loam", "Chestnut", "Bark", "Tobacco"],
      },
    ],
  },
  {
    slug: "yellows",
    name: "Yellows",
    description: "From gold leaf to hazard tape.",
    children: [
      {
        slug: "golds",
        name: "Golds",
        description: "Expensive-looking without the paperwork.",
        hue: { from: 38, to: 52 },
        saturation: { from: 52, to: 92 },
        lightness: { from: 42, to: 66 },
        adjectives: ["Gilt", "Ceremonial", "Antique", "Vested", "Solemn", "Brass"],
        nouns: ["Gold", "Saffron", "Amber", "Honey", "Bullion", "Marigold"],
      },
      {
        slug: "acids",
        name: "Acids",
        description: "Visible from orbit. Handle with sunglasses.",
        hue: { from: 52, to: 68 },
        saturation: { from: 76, to: 100 },
        lightness: { from: 48, to: 68 },
        adjectives: ["Hazard", "Unlicensed", "Screaming", "Highlighter", "Feral", "Warning"],
        nouns: ["Acid", "Citron", "Sulphur", "Chartreuse", "Neon", "Voltage"],
      },
    ],
  },
  {
    slug: "greens",
    name: "Greens",
    description: "Everything from a damp wall to a traffic light.",
    children: [
      {
        slug: "mosses",
        name: "Mosses",
        description: "Quiet greens that have been there some time.",
        hue: { from: 82, to: 140 },
        saturation: { from: 18, to: 54 },
        lightness: { from: 22, to: 48 },
        adjectives: ["Damp", "Cathedral", "Forgotten", "Northern", "Sessile", "Tuesday"],
        nouns: ["Moss", "Fern", "Sage", "Bracken", "Thicket", "Lichen"],
      },
      {
        slug: "limes",
        name: "Limes",
        description: "Greens with somewhere to be.",
        hue: { from: 68, to: 96 },
        saturation: { from: 62, to: 98 },
        lightness: { from: 44, to: 68 },
        adjectives: ["Emergency", "Tactical", "Unrepentant", "Municipal", "Bright", "Startled"],
        nouns: ["Lime", "Absinthe", "Pistachio", "Shamrock", "Wasabi", "Sap"],
      },
    ],
  },
  {
    slug: "blues",
    name: "Blues",
    description: "The largest section, because everyone's favourite colour is here.",
    children: [
      {
        slug: "cyans",
        name: "Cyans",
        description: "Swimming pools, hospital corridors, and the year 1998.",
        hue: { from: 168, to: 200 },
        saturation: { from: 48, to: 94 },
        lightness: { from: 44, to: 72 },
        adjectives: ["Municipal", "Chlorinated", "Alpine", "Refrigerated", "Clinical", "Glacial"],
        nouns: ["Cyan", "Teal", "Turquoise", "Aqua", "Lagoon", "Verdigris"],
      },
      {
        slug: "navies",
        name: "Navies",
        description: "Blues that have read the terms and conditions.",
        hue: { from: 208, to: 242 },
        saturation: { from: 38, to: 88 },
        lightness: { from: 18, to: 48 },
        adjectives: ["Admiralty", "Notarised", "Boardroom", "Deep", "Ceremonial", "Sworn"],
        nouns: ["Navy", "Indigo", "Sapphire", "Midnight", "Cobalt", "Fathom"],
      },
    ],
  },
  {
    slug: "purples",
    name: "Purples",
    description: "Historically expensive. Still behaving like it.",
    children: [
      {
        slug: "violets",
        name: "Violets",
        description: "The end of the visible spectrum, and it knows.",
        hue: { from: 262, to: 290 },
        saturation: { from: 44, to: 92 },
        lightness: { from: 34, to: 62 },
        adjectives: ["Imperial", "Operatic", "Ultra", "Regrettable", "Bishop's", "Electric"],
        nouns: ["Violet", "Amethyst", "Iris", "Plum", "Orchid", "Aubergine"],
      },
      {
        slug: "mauves",
        name: "Mauves",
        description: "Invented by accident in 1856 and never fully forgiven.",
        hue: { from: 290, to: 322 },
        saturation: { from: 20, to: 60 },
        lightness: { from: 54, to: 82 },
        adjectives: ["Faded", "Parlour", "Victorian", "Convalescent", "Dusty", "Provincial"],
        nouns: ["Mauve", "Lilac", "Heather", "Thistle", "Wisteria", "Lavender"],
      },
    ],
  },
  {
    slug: "neutrals",
    name: "Neutrals",
    description: "Colours for people who have been told to calm down.",
    children: [
      {
        slug: "greys",
        name: "Greys",
        description: "Fifty is a conservative estimate.",
        hue: { from: 200, to: 230 },
        saturation: { from: 2, to: 12 },
        lightness: { from: 28, to: 72 },
        adjectives: ["Municipal", "Battleship", "Overcast", "Committee", "Concrete", "Provisional"],
        nouns: ["Grey", "Slate", "Ash", "Pewter", "Graphite", "Drizzle"],
      },
      {
        slug: "off-whites",
        name: "Off-whites",
        description: "White, but with a lawyer present.",
        hue: { from: 28, to: 56 },
        saturation: { from: 6, to: 24 },
        lightness: { from: 84, to: 96 },
        adjectives: ["Municipal", "Landlord", "Eggshell", "Notarised", "Rental", "Beige"],
        nouns: ["Bone", "Linen", "Chalk", "Oat", "Parchment", "Vanilla"],
      },
      {
        slug: "blacks",
        name: "Blacks",
        description: "Vantablack Industries' home turf. Mind the step.",
        hue: { from: 0, to: 300 },
        saturation: { from: 0, to: 22 },
        lightness: { from: 4, to: 18 },
        adjectives: ["Absolute", "Contraband", "Tactical", "Sworn", "Total", "Unlit"],
        nouns: ["Black", "Void", "Obsidian", "Pitch", "Onyx", "Soot"],
      },
    ],
  },
];

/** Sentences appended to descriptions, chosen at random. */
export const DESCRIPTION_NOTES = [
  "Ships in a 50 ml vial with a tamper-evident seal.",
  "Not to be decanted near soft furnishings.",
  "Sold by the hue. Degrees are non-refundable.",
  "Sampled under D65 illumination, as one does.",
  "Discontinued once already. It came back.",
  "Best kept away from direct sunlight and strong opinions.",
  "Reformulated in 2019 to remove the humming.",
  "Popular with people who own exactly one chair.",
  "Our second-most-returned colour, which we consider a compliment.",
  "Comes with a card explaining what it is not.",
];

export const REVIEW_BODIES = [
  "Exactly the colour on the vial. No notes.",
  "Arrived slightly more orange than advertised. Kept it anyway.",
  "Bought this for a room. The room is now about this.",
  "Third vial this year. My partner has questions.",
  "Reads warmer under a bulb than in daylight, as you would expect.",
  "The finish is doing a lot of work here.",
  "Wanted something quieter. This is not quieter.",
  "Perfect. Would perceive again.",
  "Docked a star for the smell, which nobody mentions.",
  "It is a colour. It does colour things. Content.",
  "Cheaper than the equivalent from Munsell and honestly indistinguishable.",
  "Absolute unit of a hue.",
];
