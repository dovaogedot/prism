/**
 * Light and dark, remembered.
 *
 * The stored value is only ever "light" or "dark" — the absence of a value
 * means "follow the system", which is the default and is handled by the
 * inline script in index.html so there is no flash on load.
 */

import { Option } from "@prism/shared";
import { useCallback, useEffect, useState } from "react";

/** Which of the two rooms the shop is lit as. */
export type Theme = "light" | "dark";

const STORAGE_KEY = "hue-theme";

const isTheme = (value: string): value is Theme =>
  value === "light" || value === "dark";

const stored = (): Option<Theme> => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw !== null && isTheme(raw) ? Option.some(raw) : Option.none;
};

const systemPrefers = (): Theme =>
  window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";

const apply = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
};

/** The current theme, and the toggle that stores a choice over the system preference. */
export const useTheme = (): Readonly<{ theme: Theme; toggle: () => void }> => {
  const [theme, setTheme] = useState<Theme>(() =>
    Option.getOrElse(systemPrefers)(stored()),
  );

  useEffect(() => {
    apply(theme);
  }, [theme]);

  // Follow the OS until the visitor expresses a preference of their own.
  useEffect(() => {
    if (Option.isSome(stored())) return undefined;

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setTheme(systemPrefers());

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  return { theme, toggle };
};
