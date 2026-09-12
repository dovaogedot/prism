/**
 * Whether the page is wide enough for the filters to stand beside the results.
 *
 * The same width as Tailwind's `lg`, which is where the catalog's grid takes a
 * second column. Below it the filters and the header's switches are in the
 * drawer.
 */

import { useSyncExternalStore } from "react";

/** The query every caller shares. */
const WIDE = "(min-width: 64rem)";

const subscribe = (told: () => void): (() => void) => {
  const query = window.matchMedia(WIDE);

  query.addEventListener("change", told);

  return () => query.removeEventListener("change", told);
};

/** Whether the page is at least `lg` wide, kept current as the window resizes. */
export const useWide = (): boolean =>
  useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches);
