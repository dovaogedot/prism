/**
 * Movement that catches up, rather than movement that arrives.
 *
 * Everything on a stage follows the pointer the same way: each frame covers a
 * fraction of the distance left to cover. Exponential rather than a fixed
 * duration because the target moves under the pointer — a tween would have to
 * be restarted on every mouse event, and a restarted tween never gets
 * anywhere.
 *
 * The two constants here are the feel of the whole site. A stage with its own
 * numbers is a stage that responds differently to the same gesture.
 */

/**
 * Seconds in which about 63% of the distance left is covered.
 *
 * The time constant of the exponential, so a value is within a percent of its
 * target after about five of these.
 */
export const SETTLE_SECONDS = 0.085;

/** Below this an angle in radians is under a twentieth of a degree. */
export const SETTLED_RADIANS = 0.0008;

/**
 * One frame of a value traveling toward another.
 *
 * Framerate-independent: the fraction covered comes from the time the frame
 * actually took, so a slow frame moves further rather than slower. Elapsed
 * time before the start of the frame counts as none of it, and a time constant
 * of zero or less has the value arrive at once.
 */
export const toward = (
  current: number,
  target: number,
  elapsedSeconds: number,
  settleSeconds: number,
): number => {
  if (settleSeconds <= 0) return target;

  const covered = 1 - Math.exp(-Math.max(0, elapsedSeconds) / settleSeconds);

  return current + (target - current) * covered;
};

/**
 * Whether the distance left has stopped being a distance, and the frame loop
 * can stop.
 *
 * Exponential approach never actually reaches its target, so something has to
 * decide when the difference no longer counts. `within` is that threshold, in
 * whatever unit the two values are measured in.
 */
export const arrived = (current: number, target: number, within: number): boolean =>
  Math.abs(target - current) < within;
