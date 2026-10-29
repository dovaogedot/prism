/** The heading of the page on screen, which takes focus when a page opens. */
export const PageHeading = {
  find: (): HTMLElement | null => document.querySelector<HTMLElement>("main h1"),

  /**
   * Focuses `heading` without scrolling, since the page decides where it
   * opens. Resolves to whether focus landed, which it does not while a modal
   * dialog keeps the page inert.
   */
  focus: (heading: HTMLElement): boolean => {
    heading.tabIndex = -1
    heading.focus({ preventScroll: true })

    return document.activeElement === heading
  },
} as const
