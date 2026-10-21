/** How a header control is drawn: as an icon in the header bar, or as a row in the drawer. */
export type Look = "icon" | "row";

/** The classes of each look. */
export const LookClass = {
  icon: "grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
  row: "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
} as const satisfies Record<Look, string>;
