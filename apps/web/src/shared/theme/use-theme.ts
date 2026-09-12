/**
 * Light and dark, remembered.
 *
 * One of the two themes is always in force. A stored value picks one; with
 * nothing stored the theme follows the operating system until the visitor
 * picks for themselves. The inline script in index.html reads the same key by
 * the same rule, so the first paint is already the right one.
 */

import { useCallback, useEffect, useState } from "react";

/** Which of the two looks the page is drawn in. */
export type Theme = "light" | "dark";

export const Theme = {
  STORAGE_KEY: "prism-theme",

  is: (value: string | null): value is Theme => value === "light" || value === "dark",

  /** Whether the visitor has picked a theme, rather than being shown the system's. */
  chosen: (): boolean => Theme.is(localStorage.getItem(Theme.STORAGE_KEY)),

  systemPrefers: (): Theme =>
    window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",

  /** The theme in force: the stored choice, or the system's where there is none. */
  current: (): Theme => {
    const raw = localStorage.getItem(Theme.STORAGE_KEY);
    return Theme.is(raw) ? raw : Theme.systemPrefers();
  },

  apply: (theme: Theme): void => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  },
} as const;

/** The current theme, and the toggle that stores a choice over the system preference. */
export const useTheme = (): Readonly<{ theme: Theme; toggle: () => void }> => {
  const [theme, setTheme] = useState<Theme>(Theme.current);
  const [following, setFollowing] = useState<boolean>(() => !Theme.chosen());

  useEffect(() => {
    Theme.apply(theme);
  }, [theme]);

  useEffect(() => {
    if (!following) return undefined;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setTheme(Theme.systemPrefers());

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [following]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";

    localStorage.setItem(Theme.STORAGE_KEY, next);
    setFollowing(false);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
};
