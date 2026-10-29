import type { NavigationType } from "react-router"

/** A link to one part of a page, such as `/products/<slug>#reviews-heading`. */
export const HashTarget = {
  /**
   * Whether the location was reached by following a link, which should bring
   * its hash's target into view: an in-app link, or the page this tab first
   * opened from outside, such as a mail's link. Back and Forward, and a reload,
   * restore their own position instead.
   */
  isFollowed: (navigationType: NavigationType, key: string): boolean => {
    if (navigationType !== "POP") return true

    // The first location of a tab has react-router's key "default"; how the document itself was reached tells a link from a reload or Back.
    const [entry] = performance.getEntriesByType("navigation")
    return key === "default" && entry instanceof PerformanceNavigationTiming && entry.type === "navigate"
  },

  /** The element `hash` names, if the page has it. */
  find: (hash: string): HTMLElement | null => (hash.length <= 1 ? null : document.getElementById(decodeURIComponent(hash.slice(1)))),
} as const
