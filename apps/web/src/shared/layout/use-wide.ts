/**
 * Whether the page is wide enough for the filters to stand beside the results.
 *
 * The same width as Tailwind's `lg`. Below it the filters and the header's
 * switches are in the drawer.
 */

import { useSyncExternalStore } from "react";

export const Viewport = {
  /** The query every caller shares. */
  WIDE: "(min-width: 64rem)",

  subscribe: (told: () => void): (() => void) => {
    const query = window.matchMedia(Viewport.WIDE);

    query.addEventListener("change", told);

    return () => query.removeEventListener("change", told);
  },

  isWide: (): boolean => window.matchMedia(Viewport.WIDE).matches,
} as const;

/** Whether the page is at least `lg` wide, kept current as the window resizes. */
export const useWide = (): boolean => useSyncExternalStore(Viewport.subscribe, Viewport.isWide);
