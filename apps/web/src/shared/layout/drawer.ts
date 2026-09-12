/**
 * The drawer a narrow page keeps its filters and switches in.
 *
 * The layout owns it and puts the switches in it. A page with something of
 * its own to put there, such as the catalog's filters, renders that into
 * `slot` through a portal.
 */

import { createContext, useContext } from "react";

/** What a page can put in the drawer, and how it opens it. */
export type Drawer = Readonly<{
  /** Where a page's own part of the drawer is rendered, once the drawer is on the page. */
  slot: HTMLElement | undefined;
  /** Opens the drawer. Opening a drawer that is already open leaves it open. */
  open: () => void;
}>;

export const Drawer = {
  /** The drawer outside any layout, which has nowhere to render and nothing to open. */
  NONE: { slot: undefined, open: () => undefined } satisfies Drawer,

  /** The layout's drawer, for every page under it. */
  Context: createContext<Drawer>({ slot: undefined, open: () => undefined }),
} as const;

/** The drawer of the layout the caller is rendered in. */
export const useDrawer = (): Drawer => useContext(Drawer.Context);
