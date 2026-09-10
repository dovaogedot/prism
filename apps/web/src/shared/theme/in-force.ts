/**
 * The theme the document is in, read off the document itself.
 *
 * `use-theme.ts` chooses a theme and marks the root element with it. What is
 * here only reads that mark, so everything that depends on the theme — the
 * rooms drawn live, and the stills of them — follows one switch rather than
 * each keeping its own copy of the choice.
 */

import { useSyncExternalStore } from "react";
import type { Theme } from "./use-theme.ts";

/** The theme the root element is marked with, now. */
export const themeNow = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const subscribe = (told: () => void): (() => void) => {
  const observer = new MutationObserver(told);

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return () => observer.disconnect();
};

/** The theme the root element is marked with, following it as it changes. */
export const useThemeInForce = (): Theme => useSyncExternalStore(subscribe, themeNow);
