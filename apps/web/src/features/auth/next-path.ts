/**
 * Where signing in returns to. A page that sends a visitor to sign in names
 * itself in `?next=`. A sign-in through a provider leaves the site, so the
 * path waits in session storage until the visitor comes back.
 */

export const NextPath = {
  STORAGE_KEY: "prism-next",
  HOME: "/",

  /**
   * `value` when it is a path on this site, and the home page otherwise, so
   * a crafted link cannot send anyone to another site after signing in.
   */
  of: (value: string | null): string =>
    value !== null && /^\/(?![/\\])[^\s\u0000-\u001f]*$/.test(value) ? value : NextPath.HOME,

  /** The query that names `path` as the place to return to. */
  query: (path: string): string => `?next=${encodeURIComponent(path)}`,

  /** Keeps `path` for the return from a provider's sign-in. Blocked storage keeps nothing. */
  remember: (path: string): void => {
    try {
      sessionStorage.setItem(NextPath.STORAGE_KEY, path);
    } catch {
      // The return lands on the home page instead.
    }
  },

  /** The path kept for the return from a provider, which it then forgets; the home page when none was kept. */
  recall: (): string => {
    try {
      const kept = sessionStorage.getItem(NextPath.STORAGE_KEY);
      sessionStorage.removeItem(NextPath.STORAGE_KEY);
      return NextPath.of(kept);
    } catch {
      return NextPath.HOME;
    }
  },
} as const;
