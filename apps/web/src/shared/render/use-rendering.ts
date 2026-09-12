/**
 * Live pictures on or off, remembered.
 *
 * Drawing the catalog live costs a GPU, and a machine without one draws the
 * same pictures slowly and hotly. So the switch starts where the machine is:
 * it renders live if the browser reports real hardware, and shows the seeded
 * stills if it reports a software rasterizer. A visitor who flips it has said
 * what they want, and from then on their choice is the answer and the machine
 * is not asked again, so a software rasterizer draws live once it is asked to.
 * A browser with no WebGL2 draws nothing live, and is not offered the switch.
 *
 * One value for the whole page rather than one per stage, because the switch
 * and every picture under it have to agree the moment it is flipped.
 */

import { useCallback, useSyncExternalStore } from "react";
import { type Machine, machineNow } from "../../features/catalog/artwork/gl.ts";

const STORAGE_KEY = "hue-rendering";

/** The two things that can be stored, either of which counts as a choice. */
const LIVE = "live";
const STILL = "still";

const isChoice = (value: string | null): value is typeof LIVE | typeof STILL =>
  value === LIVE || value === STILL;

/**
 * What the machine can do, asked once.
 *
 * The probe builds a WebGL2 context to ask, so asking it per picture on a page
 * of two dozen would run the browser out of contexts before the first one is
 * drawn. `asked` says whether `machine` has been worked out yet.
 */
let asked = false;
let machine: Machine = "none";

const machineOf = (): Machine => {
  if (!asked) {
    machine = machineNow();
    asked = true;
  }

  return machine;
};

/** Whether pictures are drawn live: the stored choice, or the machine's answer. */
const current = (): boolean => {
  const raw = localStorage.getItem(STORAGE_KEY);

  return isChoice(raw) ? raw === LIVE : machineOf() === "hardware";
};

/**
 * Everyone showing a picture, so a flip reaches all of them.
 *
 * The value lives in storage rather than in state, and storage says nothing
 * when it changes, so the flip tells them itself.
 */
const watching = new Set<() => void>();

const subscribe = (told: () => void): (() => void) => {
  watching.add(told);

  return () => {
    watching.delete(told);
  };
};

/**
 * Whether pictures are drawn live, whether this browser is offered the switch
 * at all, and the switch that stores a choice.
 *
 * Every caller reads the same value and sees the same flip. Flipping stores
 * the choice, which outranks the machine from then on.
 */
export const useRendering = (): Readonly<{
  rendering: boolean;
  offered: boolean;
  toggle: () => void;
}> => {
  const rendering = useSyncExternalStore(subscribe, current);

  const toggle = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, current() ? STILL : LIVE);

    for (const told of watching) told();
  }, []);

  return { rendering, offered: machineOf() !== "none", toggle };
};
