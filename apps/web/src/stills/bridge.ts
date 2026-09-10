/**
 * What the stills page offers the script that drives it.
 *
 * The page runs in a browser and the script in Node, so the one thing they
 * share is this shape, reached through `window`.
 */

import type { StillAngle, StillSubject, StillTheme } from "@prism/shared";

/** One picture to take. */
export type StillRequest = Readonly<{
  /** The slug of the product pictured, which decides where around the angle the eye strays to. */
  slug: string;
  subject: StillSubject;
  angle: StillAngle;
  theme: StillTheme;
  /** Edge length of the square picture, in pixels. */
  size: number;
}>;

/** The page's side of the bridge. */
export type StillsBridge = Readonly<{
  /** The picture, as a `data:image/webp` URL. */
  render: (request: StillRequest) => Promise<string>;
}>;

declare global {
  // Module augmentation is the one place an interface is unavoidable.
  interface Window {
    prismStills: StillsBridge;
  }
}
