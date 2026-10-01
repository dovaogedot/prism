/** Text placed into HTML. */
export const Html = {
  /** `value` as markup that shows it literally, inside an element or a quoted attribute. */
  escape: (value: string): string =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;"),
} as const;
