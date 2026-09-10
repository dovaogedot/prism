/**
 * Whether the visitor has asked for less movement.
 *
 * Every stage on the site follows the pointer, and a visitor whose system asks
 * for reduced motion is shown the same stage standing still instead. Cutting
 * the easing rather than the movement would leave a stage snapping from
 * position to position under the pointer, which is the one thing worse than
 * the animation.
 */

import { useEffect, useState } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** True while the system asks for reduced motion, and again if that changes. */
export const usePrefersStillness = (): boolean => {
  const [still, setStill] = useState(() => window.matchMedia(REDUCED_MOTION).matches);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = (): void => setStill(query.matches);

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return still;
};
