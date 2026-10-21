import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/**
 * Keeping focus on a newly opened page's heading while the page loads. A
 * page shows a heading while its data loads and another once it has it, so
 * the heading that took focus can leave the page a moment later.
 */
const Settling = {
  /** How long a newly opened page is watched. */
  WINDOW_MS: 3000,
  /** How long the title has to stay the same before it is read out, so a loading title is skipped. */
  QUIET_MS: 400,

  heading: (): HTMLElement | null => document.querySelector<HTMLElement>("main h1"),

  focus: (heading: HTMLElement): void => {
    // Not scrolled to: the page decides where it opens, and Back restores where it was.
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  },

  /**
   * Moves focus to the page's h1, and calls `announce` with the page's title
   * once the title has stayed the same for a moment. While the page settles,
   * a heading that replaces the focused one takes focus in turn, unless the
   * reader has moved it elsewhere. The returned function stops watching.
   */
  watch: (announce: (title: string) => void): (() => void) => {
    const state: { focused: HTMLElement | undefined; quiet: number | undefined } = { focused: undefined, quiet: undefined };

    const refocus = (): void => {
      const heading = Settling.heading();
      if (heading === null || heading === state.focused) return;

      const isFocusLost = state.focused === undefined || (!state.focused.isConnected && document.activeElement === document.body);
      if (isFocusLost) {
        Settling.focus(heading);
        state.focused = heading;
      }
    };

    // Only the title restarts the wait; the rest of the page may keep changing for a while.
    const scheduleAnnouncement = (): void => {
      window.clearTimeout(state.quiet);
      state.quiet = window.setTimeout(() => announce(document.title), Settling.QUIET_MS);
    };

    const page = new MutationObserver(refocus);
    const head = new MutationObserver(scheduleAnnouncement);
    page.observe(document.body, { childList: true, subtree: true });
    head.observe(document.head, { childList: true, subtree: true, characterData: true });
    const timer = window.setTimeout(() => {
      page.disconnect();
      head.disconnect();
    }, Settling.WINDOW_MS);

    refocus();
    scheduleAnnouncement();

    return () => {
      page.disconnect();
      head.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(state.quiet);
    };
  },
} as const;

/**
 * Tells a screen reader that the page changed, which a page swapped in
 * without a load does not do by itself: focus moves to the new page's h1,
 * and its title is read out from a polite live region. The first page is
 * left alone, because the browser announces a page it loads.
 */
export const RouteAnnouncer = () => {
  const { pathname } = useLocation();

  const [announcement, setAnnouncement] = useState("");

  // The path last announced, so the first render and its development-mode repeat announce nothing.
  const announced = useRef(pathname);

  useEffect(() => {
    if (announced.current === pathname) return;
    announced.current = pathname;

    return Settling.watch(setAnnouncement);
  }, [pathname]);

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  );
};
