/**
 * Titles and meta descriptions sized the way search engines show them in
 * full: a title within 60 characters, and a description of 155 to 160.
 */

export const Seo = {
  SITE: "Prism",
  TITLE_MAX: 60,
  DESCRIPTION_MIN: 155,
  DESCRIPTION_MAX: 160,
  /** The shortest a cut opening fragment may become, so the description keeps what it is about. */
  OPENING_MIN: 60,

  /** `text` with every run of whitespace made one space, and none at either end. */
  clean: (text: string): string => text.replace(/\s+/g, " ").trim(),

  /** `text` cleaned, and ended with a full stop unless it already ends a sentence. */
  sentence: (text: string): string => {
    const cleaned = Seo.clean(text);
    return cleaned.length === 0 || /[.!?…]$/.test(cleaned) ? cleaned : `${cleaned}.`;
  },

  /**
   * `text` cut at the last word boundary that keeps it within `max`
   * characters, without trailing punctuation that would dangle; `text`
   * itself when it already fits. A single word longer than `max` is cut
   * inside the word.
   */
  cut: (text: string, max: number): string => {
    if (text.length <= max) return text;

    const room = text.slice(0, max + 1);
    const boundary = room.lastIndexOf(" ");
    const kept = boundary > 0 ? room.slice(0, boundary) : text.slice(0, max);

    return kept.replace(/[\s,;:(-]+$/, "");
  },

  /** "<page> | Prism", the page part cut at a word boundary so the whole stays within 60 characters. */
  title: (page: string): string => {
    const suffix = ` | ${Seo.SITE}`;
    return `${Seo.cut(Seo.clean(page), Seo.TITLE_MAX - suffix.length)}${suffix}`;
  },

  /**
   * A description of 155 to 160 characters from `fragments`, in their order,
   * each ended as a sentence. The first fragment opens it, cut at a word boundary with an ellipsis
   * when that makes room; each later fragment is kept whole or left out. Of
   * every way to land in range, the one with the longest opening wins, then
   * the one keeping the earliest fragments. When none lands in range, the
   * longest text within 160 is returned.
   */
  description: (fragments: readonly string[]): string => {
    const [lead = "", ...rest] = fragments.map(Seo.sentence).filter((fragment) => fragment.length > 0);
    let best = "";

    for (const opening of Seo.openings(lead)) {
      // Masks count down, so a set holding an earlier fragment comes before one without it.
      for (let mask = 2 ** rest.length - 1; mask >= 0; mask -= 1) {
        let text = opening;

        for (let index = 0; index < rest.length; index += 1) {
          if ((mask & (1 << (rest.length - 1 - index))) !== 0) text = `${text} ${rest[index] ?? ""}`;
        }

        if (text.length > Seo.DESCRIPTION_MAX) continue;
        if (text.length >= Seo.DESCRIPTION_MIN) return text;
        if (text.length > best.length) best = text;
      }
    }

    return best;
  },

  /** The ways a description can open with `lead`: whole when it fits, then cut shorter word by word. */
  openings: (lead: string): readonly string[] => {
    const openings: string[] = lead.length <= Seo.DESCRIPTION_MAX ? [lead] : [];

    for (let max = Math.min(lead.length, Seo.DESCRIPTION_MAX) - 1; max >= Seo.OPENING_MIN; max -= 1) {
      const opening = `${Seo.cut(lead, max - 1)}…`;
      if (opening !== openings.at(-1)) openings.push(opening);
    }

    return openings;
  },
} as const;
