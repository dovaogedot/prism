/**
 * Light and dark, remembered.
 *
 * There are two themes and one of them is always in force. A stored value picks
 * one; with nothing stored the theme is whichever the operating system is set
 * to, and it keeps following the system until the visitor picks for themselves.
 * The inline script in index.html reads the same key by the same rule, so the
 * first paint is already the right one.
 */

import { useCallback, useEffect, useState } from "react";

/** Which of the two rooms the shop is lit as. */
export type Theme = "light" | "dark";

const STORAGE_KEY = "hue-theme";

const isTheme = (value: string | null): value is Theme =>
  value === "light" || value === "dark";

/** Whether the visitor has picked a theme, rather than being shown the system's. */
const chosen = (): boolean => isTheme(localStorage.getItem(STORAGE_KEY));

const systemPrefers = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** The theme in force: the stored choice, or the system's where there is none. */
const current = (): Theme => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return isTheme(raw) ? raw : systemPrefers();
};

const apply = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

/** The current theme, and the toggle that stores a choice over the system preference. */
export const useTheme = (): Readonly<{ theme: Theme; toggle: () => void }> => {
  const [theme, setTheme] = useState<Theme>(current);
  const [following, setFollowing] = useState<boolean>(() => !chosen());

  useEffect(() => {
    apply(theme);
  }, [theme]);

  useEffect(() => {
    if (!following) return undefined;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setTheme(systemPrefers());

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [following]);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";

    localStorage.setItem(STORAGE_KEY, next);
    setFollowing(false);
    setTheme(next);
  }, [theme]);

  return { theme, toggle };
};
