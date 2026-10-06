/**
 * Light and dark, remembered.
 *
 * One of the two themes is always in force. A stored value picks one; with
 * nothing stored the theme follows the operating system until the visitor
 * picks for themselves. The inline script in index.html reads the same key by
 * the same rule, so the first paint is already the right one.
 *
 * The `dark` class on the root element is the one record of the theme in
 * force, so every component that reads the theme sees the same one.
 */

import { useCallback, useSyncExternalStore } from "react";

/** Which of the two looks the page is drawn in. */
export type Theme = "light" | "dark";

export const Theme = {
  STORAGE_KEY: "prism-theme",

  is: (value: string | null): value is Theme => value === "light" || value === "dark",

  /** Whether the visitor has picked a theme, rather than being shown the system's. */
  chosen: (): boolean => Theme.is(localStorage.getItem(Theme.STORAGE_KEY)),

  systemPrefers: (): Theme =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",

  /** The theme the page is drawn in right now. */
  shown: (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light"),

  apply: (theme: Theme): void => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  },

  /** Every component reading the theme, told when it changes. */
  listeners: new Set<() => void>(),

  /** Stores `theme` over the system preference, draws the page in it, and tells every reader. */
  choose: (theme: Theme): void => {
    localStorage.setItem(Theme.STORAGE_KEY, theme);
    Theme.apply(theme);
    for (const listener of Theme.listeners) listener();
  },

  /**
   * Calls `listener` whenever the theme changes, including when the system
   * preference changes while no theme is stored. Shaped for `useSyncExternalStore`.
   */
  subscribe: (listener: () => void): (() => void) => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = (): void => {
      if (Theme.chosen()) return;
      Theme.apply(Theme.systemPrefers());
      listener();
    };

    Theme.listeners.add(listener);
    query.addEventListener("change", followSystem);

    return () => {
      Theme.listeners.delete(listener);
      query.removeEventListener("change", followSystem);
    };
  },
} as const;

/** The current theme, the same in every component, and the toggle that stores a choice over the system preference. */
export const useTheme = (): Readonly<{ theme: Theme; toggle: () => void }> => {
  const theme = useSyncExternalStore(Theme.subscribe, Theme.shown);

  const toggle = useCallback(() => Theme.choose(theme === "dark" ? "light" : "dark"), [theme]);

  return { theme, toggle };
};
