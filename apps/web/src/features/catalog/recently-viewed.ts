/**
 * The products this browser opened last, newest first. They are kept in
 * local storage, as a convenience for one browser and nothing more: blocked
 * or corrupted storage reads as an empty list, and a write that fails is
 * dropped.
 */

import { Slug } from "@prism/shared";
import { z } from "zod";

export const RecentlyViewed = {
  STORAGE_KEY: "prism-recently-viewed",
  /** The most products the list keeps. */
  MAX: 12,

  /** `list` with `slug` first, without its earlier place, cut to the most the list keeps. */
  add: (list: readonly Slug[], slug: Slug): readonly Slug[] =>
    [slug, ...list.filter((kept) => kept !== slug)].slice(0, RecentlyViewed.MAX),

  /** The list stored as `stored`; empty for anything that is not a list of slugs. */
  parse: (stored: string | null): readonly Slug[] => {
    if (stored === null) return [];

    try {
      const parsed = z.array(Slug.schema).safeParse(JSON.parse(stored));
      return parsed.success ? parsed.data.slice(0, RecentlyViewed.MAX) : [];
    } catch {
      return [];
    }
  },

  read: (): readonly Slug[] => {
    try {
      return RecentlyViewed.parse(localStorage.getItem(RecentlyViewed.STORAGE_KEY));
    } catch {
      return [];
    }
  },

  /** Puts `slug` first in the stored list. */
  remember: (slug: Slug): void => {
    try {
      localStorage.setItem(RecentlyViewed.STORAGE_KEY, JSON.stringify(RecentlyViewed.add(RecentlyViewed.read(), slug)));
    } catch {
      // Storage is blocked or full; the list is a convenience, so nothing is lost.
    }
  },
} as const;
