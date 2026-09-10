/**
 * Where the pointer is, relative to the stage it is over.
 *
 * Every stage on the site reads the pointer and turns it into something —
 * an angle, a camera position, a hue — and all of them start from the same
 * question: how far from the middle of this box is the finger, either way.
 * The answer is a pair of fractions rather than pixels, so a card and a
 * product page respond identically to the same gesture on a different size.
 */

/** A position inside the stage, measured from its top-left corner. */
export type Point = Readonly<{ x: number; y: number }>;

/** How big the stage is on screen. Only the ratio of the two ever matters. */
export type Size = Readonly<{ width: number; height: number }>;

/**
 * How far the pointer is from the middle of the stage, from -1 to 1 on each
 * axis. `down` follows the screen, so it grows toward the bottom edge.
 */
export type Offset = Readonly<{ across: number; down: number }>;

/** Dead center, which is where a stage nobody is pointing at reads. */
export const MIDDLE: Offset = { across: 0, down: 0 };

const clampUnit = (value: number): number => Math.max(-1, Math.min(1, value));

/**
 * JavaScript has two zeroes and multiplying the positive one by a negative
 * yields the negative one. Nothing downstream wants to be told that a stage
 * dead center is offset by minus nothing.
 */
const unsigned = (value: number): number => (value === 0 ? 0 : value);

/**
 * Where the pointer is inside the stage.
 *
 * Clamped, because pointer capture goes on reporting positions after the
 * finger has left the box, and the stage is already as far over as it goes. A
 * stage with no width or no height has no middle to measure from, so nothing
 * is offset from it.
 */
export const offsetIn = (pointer: Point, stage: Size): Offset => {
  const halfWidth = stage.width / 2;
  const halfHeight = stage.height / 2;

  if (halfWidth <= 0 || halfHeight <= 0) return MIDDLE;

  return {
    across: unsigned(clampUnit((pointer.x - halfWidth) / halfWidth)),
    down: unsigned(clampUnit((pointer.y - halfHeight) / halfHeight)),
  };
};
