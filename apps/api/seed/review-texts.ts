/** The titles and bodies seeded reviews are written from, by star rating. */

/** One star rating's parts: the titles, and the openings, details and closings a body is joined from. */
export type ReviewParts = Readonly<{
  titles: readonly string[];
  openings: readonly string[];
  details: readonly string[];
  closings: readonly string[];
}>;

/** One review text: a title and the body under it. */
export type ReviewText = Readonly<{ title: string; body: string }>;

export const ReviewTexts = {
  byRating: {
    1: {
      titles: ["Not what I expected", "Disappointed", "Would not buy again", "Waste of money", "Broke too soon", "Poor quality"],
      openings: [
        "It looked very different from the pictures.",
        "The quality is poor for the price.",
        "It does not do what the description says.",
        "I had high hopes, but this let me down.",
        "It arrived damaged and never worked right.",
        "I sent it back after two days.",
      ],
      details: [
        "The edges were rough and one part was loose when it arrived.",
        "It stopped working after a week.",
        "The color faded within days.",
        "The finish started to peel almost at once.",
        "It is much smaller than the photos suggest.",
        "Nothing about it feels solid.",
      ],
      closings: [
        "I would not recommend it.",
        "Support was friendly, but the product itself let me down.",
        "Save your money for something else.",
        "I will not order this again.",
        "One star for the fast delivery.",
        "Very disappointing overall.",
      ],
    },
    2: {
      titles: ["Could be better", "Not great", "Below average", "Hard to recommend", "Mixed feelings", "Expected more"],
      openings: [
        "It works, but only just.",
        "Some parts are fine, others not so much.",
        "It is usable, but I expected more.",
        "The idea is good, the execution is not.",
        "It does the basics and nothing else.",
        "I wanted to like it more than I do.",
      ],
      details: [
        "The finish wears off quickly and it feels cheaper than it looks.",
        "One corner was scratched when it arrived.",
        "It took almost two weeks to arrive.",
        "The size is a bit off from what the page says.",
        "The color is darker than in the photos.",
        "It makes a faint rattling noise.",
      ],
      closings: [
        "I will probably look elsewhere next time.",
        "Not worth the full price.",
        "Maybe worth it on sale.",
        "I kept it, but only just.",
        "Fine for a gift you do not care much about.",
        "Two stars, because it does work.",
      ],
    },
    3: {
      titles: ["Okay for the price", "Average", "It does the job", "Fine, nothing more", "Decent", "Middle of the road"],
      openings: [
        "Decent quality, and it arrived well packed.",
        "Not bad, not great.",
        "It works as described.",
        "It is exactly average.",
        "For what it costs, it is fine.",
        "It does what it should.",
      ],
      details: [
        "The color is a little duller than in the photos.",
        "It took a few days longer than promised.",
        "The materials feel a bit light.",
        "It is slightly smaller than I imagined.",
        "The instructions could be clearer.",
        "One small part looks a bit cheap.",
      ],
      closings: [
        "I would look around before buying another one.",
        "No complaints, but no excitement either.",
        "It will do for now.",
        "Good enough for everyday use.",
        "Fair for the price.",
        "Three stars feels right.",
      ],
    },
    4: {
      titles: ["Very good", "Happy with it", "Good value", "Recommended", "Nearly perfect", "Solid choice"],
      openings: [
        "Solid and well made.",
        "Looks great and works well.",
        "Better than I expected for the price.",
        "Does exactly what it says.",
        "A really nice piece overall.",
        "I am pleased with this purchase.",
      ],
      details: [
        "One small detail could be better.",
        "It took a few days longer to arrive than I hoped.",
        "The size is just right and it feels sturdy.",
        "The packaging was a bit much, but nothing was damaged.",
        "The color is very close to the photos.",
        "It feels heavier and better made than it looks.",
      ],
      closings: [
        "I am happy with it and use it daily.",
        "It was worth the wait.",
        "I bought one for a friend as well.",
        "I would buy it again.",
        "Four stars only because nothing is perfect.",
        "Recommended.",
      ],
    },
    5: {
      titles: ["Exactly what I hoped for", "Love it", "Perfect gift", "Five stars", "Absolutely great", "Better than expected"],
      openings: [
        "Arrived quickly and looks even better in person.",
        "Beautifully made and a joy to use.",
        "Bought it as a present and it was a big hit.",
        "Great quality, fair price and fast delivery.",
        "I could not be happier with it.",
        "This is the best thing I bought this year.",
      ],
      details: [
        "The details are lovely.",
        "It has become my favorite thing on the shelf.",
        "It was well packed and arrived a day early.",
        "Everything about it feels carefully made.",
        "The colors are bright and true to the photos.",
        "It fits perfectly where I wanted it.",
      ],
      closings: [
        "Would buy again.",
        "I have nothing to complain about.",
        "Highly recommended.",
        "I am already planning to order another one.",
        "Worth every cent.",
        "Five stars, easily.",
      ],
    },
  } as const satisfies Record<1 | 2 | 3 | 4 | 5, ReviewParts>,

  /** A title and a body made from `parts`, each piece chosen by `pick`. */
  compose: (parts: ReviewParts, pick: (pieces: readonly string[]) => string): ReviewText => ({
    title: pick(parts.titles),
    body: [pick(parts.openings), pick(parts.details), pick(parts.closings)].join(" "),
  }),
} as const;
