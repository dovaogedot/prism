/** The titles and bodies seeded reviews are written from, by star rating. */

/** One review text: a title and the body under it. */
export type ReviewText = Readonly<{ title: string; body: string }>;

export const ReviewTexts = {
  byRating: {
    1: [
      { title: "Not what I expected", body: "It looked very different from the pictures, and it stopped working after a week. I sent it back." },
      { title: "Disappointed", body: "The quality is poor for the price. The edges were rough and one part was loose when it arrived." },
      { title: "Would not buy again", body: "It does not do what the description says. Support was friendly, but the product itself let me down." },
    ],
    2: [
      { title: "Could be better", body: "It works, but only just. The finish wears off quickly and it feels cheaper than it looks." },
      { title: "Below average", body: "Delivery was fast, which is the best thing I can say. The item itself is flimsy and smaller than I thought." },
      { title: "Meh", body: "Some nice ideas, but too many small problems. I expected more at this price." },
    ],
    3: [
      { title: "It is fine", body: "Does the job, nothing more. Good enough for everyday use if you do not expect too much." },
      { title: "Okay for the price", body: "Decent quality and it arrived well packed. The color is a little duller than in the photos." },
      { title: "Average", body: "Not bad, not great. It works as described, but I would look around before buying another one." },
    ],
    4: [
      { title: "Very good", body: "Solid and well made. One small detail could be better, but I am happy with it and use it daily." },
      { title: "Happy with it", body: "Looks great and works well. It took a few days longer to arrive than I hoped, but it was worth the wait." },
      { title: "Good value", body: "Better than I expected for the price. The size is just right and it feels sturdy." },
      { title: "Recommended", body: "Does exactly what it says. I bought one for a friend as well, and they like it too." },
    ],
    5: [
      { title: "Exactly what I hoped for", body: "Arrived quickly and looks even better in person. The details are lovely. Would buy again." },
      { title: "Love it", body: "Beautifully made and a joy to use. It has become my favorite thing on the shelf." },
      { title: "Perfect gift", body: "Bought it as a present and it was a big hit. Well packed, and it arrived a day early." },
      { title: "Five stars", body: "Great quality, fair price and fast delivery. I have nothing to complain about." },
    ],
  } as const satisfies Record<1 | 2 | 3 | 4 | 5, readonly ReviewText[]>,
} as const;
