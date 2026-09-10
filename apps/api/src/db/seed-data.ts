/**
 * The catalog's vocabulary.
 *
 * Colors are generated rather than listed: each leaf category owns an arc of
 * the hue circle and a set of words, and the seed combines them. That gives a
 * few hundred distinct products from a page of data, and every product still
 * has a name someone would plausibly ask for by name.
 */

import type { Finish } from "@prism/shared";

/** A top-level category, and the branches of its taxonomy. */
export type CategorySeed = Readonly<{
  slug: string;
  name: string;
  description: string;
  children: readonly LeafCategorySeed[];
}>;

/** A branch of the finisher or shifter taxonomy, and the stock it holds. */
export type InstrumentSeed = Readonly<{
  slug: string;
  name: string;
  description: string;
  adjectives: readonly string[];
  nouns: readonly string[];
}>;

/** A branch of the color taxonomy: the patch of HSL space it holds, and how its colors are named. */
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

/** The foundries the catalog is sold under. */
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
      "Specialists in the darker end of the catalog. Their showroom has never been successfully photographed.",
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
      "Rigorous, systematic, and quietly furious about how everyone else numbers their colors.",
  },
  {
    slug: "bauhaus-bros",
    name: "Bauhaus Bros",
    description:
      "Three primaries, three shapes, no discussion. Their catalog is one page and they are proud of it.",
  },
  {
    slug: "hexadecimal-holdings",
    name: "Hexadecimal Holdings",
    description:
      "Sells colors strictly by their hex value and considers names a marketing affectation.",
  },
  {
    slug: "perceptual-uniform",
    name: "Perceptual Uniform Ltd",
    description:
      "Every color is exactly as far from its neighbor as it looks. This took eleven years.",
  },
] as const;

/** The three words, in the order the seed walks them. */
export const FINISHES: readonly Finish[] = ["roughness", "iridescent", "fluorescent"];

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
  "Notarized",
];

/** The whole taxonomy, and the color space each branch of it draws from. */
export const CATEGORIES: readonly CategorySeed[] = [
  {
    slug: "red",
    name: "Red",
    description: "Loud, arterial, or apologetic. There is no middle ground here.",
    children: [
      {
        slug: "crimson",
        name: "Crimson",
        description: "The serious reds. Wear a tie.",
        hue: { from: 348, to: 10 },
        saturation: { from: 62, to: 96 },
        lightness: { from: 28, to: 54 },
        adjectives: [...CEREMONIAL, "Cardinal", "Imperial"],
        nouns: ["Crimson", "Scarlet", "Vermilion", "Carmine", "Garnet", "Claret"],
      },
      {
        slug: "blush",
        name: "Blush",
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
    slug: "orange",
    name: "Orange",
    description: "Rust, terracotta, and the color of a good afternoon.",
    children: [
      {
        slug: "rust",
        name: "Rust",
        description: "Oxidized, weathered, faintly agricultural.",
        hue: { from: 12, to: 32 },
        saturation: { from: 48, to: 88 },
        lightness: { from: 34, to: 56 },
        adjectives: [...CEREMONIAL, "Corrugated", "Abandoned"],
        nouns: ["Rust", "Terracotta", "Ocher", "Paprika", "Tangerine", "Ember"],
      },
      {
        slug: "earth",
        name: "Earth",
        description: "Browns for people who say 'browns' without flinching.",
        hue: { from: 20, to: 40 },
        saturation: { from: 18, to: 52 },
        lightness: { from: 20, to: 46 },
        adjectives: ["Plowed", "Peat", "Reclaimed", "Honest", "Weekday", "Cellar"],
        nouns: ["Umber", "Sienna", "Loam", "Chestnut", "Bark", "Tobacco"],
      },
    ],
  },
  {
    slug: "yellow",
    name: "Yellow",
    description: "From gold leaf to hazard tape.",
    children: [
      {
        slug: "gold",
        name: "Gold",
        description: "Expensive-looking without the paperwork.",
        hue: { from: 38, to: 52 },
        saturation: { from: 52, to: 92 },
        lightness: { from: 42, to: 66 },
        adjectives: ["Gilt", "Ceremonial", "Antique", "Vested", "Solemn", "Brass"],
        nouns: ["Gold", "Saffron", "Amber", "Honey", "Bullion", "Marigold"],
      },
      {
        slug: "acid",
        name: "Acid",
        description: "Visible from orbit. Handle with sunglasses.",
        hue: { from: 52, to: 68 },
        saturation: { from: 76, to: 100 },
        lightness: { from: 48, to: 68 },
        adjectives: ["Hazard", "Unlicensed", "Screaming", "Highlighter", "Feral", "Warning"],
        nouns: ["Acid", "Citron", "Sulfur", "Chartreuse", "Neon", "Voltage"],
      },
    ],
  },
  {
    slug: "green",
    name: "Green",
    description: "Everything from a damp wall to a traffic light.",
    children: [
      {
        slug: "moss",
        name: "Moss",
        description: "Quiet greens that have been there some time.",
        hue: { from: 82, to: 140 },
        saturation: { from: 18, to: 54 },
        lightness: { from: 22, to: 48 },
        adjectives: ["Damp", "Cathedral", "Forgotten", "Northern", "Sessile", "Tuesday"],
        nouns: ["Moss", "Fern", "Sage", "Bracken", "Thicket", "Lichen"],
      },
      {
        slug: "lime",
        name: "Lime",
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
    slug: "blue",
    name: "Blue",
    description: "The largest section, because everyone's favorite color is here.",
    children: [
      {
        slug: "cyan",
        name: "Cyan",
        description: "Swimming pools, hospital corridors, and the year 1998.",
        hue: { from: 168, to: 200 },
        saturation: { from: 48, to: 94 },
        lightness: { from: 44, to: 72 },
        adjectives: ["Municipal", "Chlorinated", "Alpine", "Refrigerated", "Clinical", "Glacial"],
        nouns: ["Cyan", "Teal", "Turquoise", "Aqua", "Lagoon", "Verdigris"],
      },
      {
        slug: "navy",
        name: "Navy",
        description: "Blues that have read the terms and conditions.",
        hue: { from: 208, to: 242 },
        saturation: { from: 38, to: 88 },
        lightness: { from: 18, to: 48 },
        adjectives: ["Admiralty", "Notarized", "Boardroom", "Deep", "Ceremonial", "Sworn"],
        nouns: ["Navy", "Indigo", "Sapphire", "Midnight", "Cobalt", "Fathom"],
      },
    ],
  },
  {
    slug: "purple",
    name: "Purple",
    description: "Historically expensive. Still behaving like it.",
    children: [
      {
        slug: "violet",
        name: "Violet",
        description: "The end of the visible spectrum, and it knows.",
        hue: { from: 262, to: 290 },
        saturation: { from: 44, to: 92 },
        lightness: { from: 34, to: 62 },
        adjectives: ["Imperial", "Operatic", "Ultra", "Regrettable", "Bishop's", "Electric"],
        nouns: ["Violet", "Amethyst", "Iris", "Plum", "Orchid", "Aubergine"],
      },
      {
        slug: "mauve",
        name: "Mauve",
        description: "Invented by accident in 1856 and never fully forgiven.",
        hue: { from: 290, to: 322 },
        saturation: { from: 20, to: 60 },
        lightness: { from: 54, to: 82 },
        adjectives: ["Faded", "Parlor", "Victorian", "Convalescent", "Dusty", "Provincial"],
        nouns: ["Mauve", "Lilac", "Heather", "Thistle", "Wisteria", "Lavender"],
      },
    ],
  },
  {
    slug: "neutral",
    name: "Neutral",
    description: "Colors for people who have been told to calm down.",
    children: [
      {
        slug: "gray",
        name: "Gray",
        description: "Fifty is a conservative estimate.",
        hue: { from: 200, to: 230 },
        saturation: { from: 2, to: 12 },
        lightness: { from: 28, to: 72 },
        adjectives: ["Municipal", "Battleship", "Overcast", "Committee", "Concrete", "Provisional"],
        nouns: ["Gray", "Slate", "Ash", "Pewter", "Graphite", "Drizzle"],
      },
      {
        slug: "off-white",
        name: "Off-white",
        description: "White, but with a lawyer present.",
        hue: { from: 28, to: 56 },
        saturation: { from: 6, to: 24 },
        lightness: { from: 84, to: 96 },
        adjectives: ["Municipal", "Landlord", "Eggshell", "Notarized", "Rental", "Beige"],
        nouns: ["Bone", "Linen", "Chalk", "Oat", "Parchment", "Vanilla"],
      },
      {
        slug: "black",
        name: "Black",
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

/* ------------------------------------------------------------- finishers */

/**
 * Tools that put a finish back on a color you already own. They carry the same
 * three amounts a color does — the finish they apply — and a durability, being
 * how many colors one will see through before it stops meaning it.
 */
export const FINISHER_BRANCHES: readonly InstrumentSeed[] = [
  {
    slug: "applicator",
    name: "Applicator",
    description: "Hand-held. Applied by someone who has read the leaflet.",
    adjectives: [
      "Bristled",
      "Municipal",
      "Two-handed",
      "Trigger",
      "Notarized",
      "Weekday",
      "Reconditioned",
      "Union-approved",
    ],
    nouns: ["Applicator", "Wand", "Roller", "Nib", "Pad", "Trowel"],
  },
  {
    slug: "bath",
    name: "Bath",
    description: "You lower the color in and wait. Do not agitate.",
    adjectives: [
      "Immersion",
      "Overnight",
      "Cold",
      "Ceremonial",
      "Industrial",
      "Provisional",
      "Unattended",
      "Deep",
    ],
    nouns: ["Bath", "Dip", "Vat", "Soak", "Tank", "Steep"],
  },
];

/** What the finish a finisher leaves says about it. */
export const FINISHER_NOTES: Record<Finish, string> = {
  roughness:
    "Takes a surface to the grain on the tin, whether that is a mirror or a wall of chalk. The most-returned finisher we stock, and the one we stand behind.",
  iridescent:
    "Restores the disagreement between where you stand and what you see. Apply in a room with more than one chair.",
  fluorescent:
    "Puts the shouting back. Certified for indoor use in three countries, none of which we will name.",
};

/* -------------------------------------------------------------- shifters */

/**
 * Tools that turn a color you own into one you would rather have. Sold by the
 * degree, clockwise or counter-clockwise, and nothing else about them varies.
 */
export const SHIFTER_BRANCHES: readonly InstrumentSeed[] = [
  {
    slug: "nudge",
    name: "Nudge",
    description: "For colors that are nearly right and know it.",
    adjectives: [
      "Polite",
      "Apologetic",
      "Desk",
      "Pocket",
      "Sunday",
      "Provisional",
      "Committee",
      "Hairline",
    ],
    nouns: ["Nudge", "Tap", "Correction", "Adjustment", "Note", "Hint"],
  },
  {
    slug: "swing",
    name: "Swing",
    description:
      "For colors that need to become a different argument entirely.",
    adjectives: [
      "Unrepentant",
      "Operatic",
      "Tactical",
      "Contraband",
      "Emergency",
      "Absolute",
      "Regrettable",
      "Screaming",
    ],
    nouns: ["Swing", "Rotation", "Sweep", "Turn", "Lurch", "Reversal"],
  },
];

/** Where a shifter leaves you, depending on which way it turns. */
export const DIRECTION_NOTES = {
  cw: "Walks toward the reds, and warms on the way.",
  ccw: "Walks toward the blues, and cools on the way.",
} as const;

/** Sentences appended to a finisher's or shifter's description. */
export const INSTRUMENT_NOTES = [
  "Comes with a card explaining what it will not do.",
  "Sold without a warranty, on principle.",
  "Do not use on a color you are fond of.",
  "Best kept away from direct sunlight and strong opinions.",
  "Our returns desk has asked us to stop stocking this. We have declined.",
  "Reformulated in 2019 to remove the humming.",
  "Works on any color. Works well on fewer.",
  "Instructions are printed on the inside, where you will find them later.",
];

/** Sentences appended to descriptions, chosen at random. */
export const DESCRIPTION_NOTES = [
  "Delivered whole. There is nothing to open.",
  "Not to be looked at near soft furnishings.",
  "Sold by the hue. Degrees are non-refundable.",
  "Sampled under D65 illumination, as one does.",
  "Discontinued once already. It came back.",
  "Best kept away from direct sunlight and strong opinions.",
  "Reformulated in 2019 to remove the humming.",
  "Popular with people who own exactly one chair.",
  "Our second-most-returned color, which we consider a compliment.",
  "Comes with a card explaining what it is not.",
];

/** What reviewers say, drawn from at random. */
export const REVIEW_BODIES = [
  "Exactly the color on the listing. No notes.",
  "Arrived slightly more orange than advertised. Kept it anyway.",
  "Bought this for a room. The room is now about this.",
  "Third one this year. My partner has questions.",
  "Reads warmer under a bulb than in daylight, as you would expect.",
  "The finish is doing a lot of work here.",
  "Wanted something quieter. This is not quieter.",
  "Perfect. Would perceive again.",
  "Docked a star for the smell, which nobody mentions.",
  "It is a color. It does color things. Content.",
  "Cheaper than the equivalent from Munsell and honestly indistinguishable.",
  "Absolute unit of a hue.",
];
