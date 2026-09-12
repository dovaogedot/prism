/**
 * The phone's tilt, as one feed every stage on the page can follow.
 *
 * One `deviceorientation` listener for the document however many stages follow
 * it, and one idea of how the phone is held, so every stage on screen answers
 * the same tilt at the same moment. A browser with nothing to report either
 * never fires the event or fires it with no angles in it, and until a reading
 * with angles arrives nothing here claims the phone tilts. That is what leaves
 * a stage following a finger instead.
 *
 * Safari asks the visitor before it reports a tilt, and only asks from inside
 * something the visitor did. `askForTilt` is that ask.
 */

import { Option } from "@prism/shared";
import { fallOf, heldAfter, leanOf, movedFrom, type Fall } from "./lean.ts";
import { MIDDLE, type Offset } from "./pointer.ts";

/** A stage following the tilt, handed each lean worth passing on. */
export type Follower = (lean: Offset) => void;

/** How the phone is held, and when that was last brought up to date. */
type Held = Readonly<{
  fall: Fall;
  /** In seconds, on the clock event time stamps are measured on. */
  at: number;
}>;

/**
 * A browser's `DeviceOrientationEvent`, where it asks the visitor before
 * reporting anything.
 */
type Asking = Readonly<{ requestPermission: () => Promise<string> }>;

const followers = new Set<Follower>();

/** `None` until the phone reports a reading with angles in it. */
let held: Option<Held> = Option.none;

/** The last lean handed to the followers. */
let passedOn: Offset = MIDDLE;

let listening = false;
let asked = false;

/** How far the page is turned from the phone's own upright, in degrees. */
const screenDegrees = (): number =>
  // Older Safari has no `screen.orientation`, and is upright as far as a page
  // can tell.
  typeof screen.orientation === "undefined" ? 0 : screen.orientation.angle;

const hear = (event: DeviceOrientationEvent): void => {
  if (event.beta === null || event.gamma === null) return;

  const fall = fallOf({ beta: event.beta, gamma: event.gamma });
  const at = event.timeStamp / 1000;
  const now = Option.match<Held, Held>({
    onNone: () => ({ fall, at }),
    onSome: (was) => ({ fall: heldAfter(was.fall, fall, at - was.at), at }),
  })(held);

  held = Option.some(now);

  const lean = leanOf(fall, now.fall, screenDegrees());

  if (!movedFrom(passedOn, lean)) return;

  passedOn = lean;
  for (const follower of followers) follower(lean);
};

const listen = (): void => {
  if (listening) return;

  listening = true;
  window.addEventListener("deviceorientation", hear);
};

const asksFirst = (events: object): events is Asking =>
  "requestPermission" in events && typeof events.requestPermission === "function";

const nothing = (): void => undefined;

/** Whether the phone has reported a tilt, which a stage then follows instead of a finger. */
export const tilting = (): boolean => Option.isSome(held);

/**
 * Follow the phone's tilt until the returned function is called.
 *
 * Handed the lean at once where the phone has already reported one, so a stage
 * that comes on screen stands where the others already do, and after that
 * each time the lean moves.
 */
export const followTilt = (follower: Follower): (() => void) => {
  listen();
  followers.add(follower);

  if (tilting()) follower(passedOn);

  return () => {
    followers.delete(follower);
  };
};

/**
 * Ask the visitor to let the page read the tilt, where the browser asks first.
 *
 * Asks at most once a page, and only has an effect when called from inside
 * something the visitor did, such as a finger lifting. A browser that reports
 * a tilt without asking is left as it is.
 */
export const askForTilt = (): void => {
  if (asked || tilting() || typeof DeviceOrientationEvent === "undefined") return;

  asked = true;
  listen();

  // Granted, the readings start arriving at the listener already on the page;
  // refused, the stages go on following a finger.
  if (asksFirst(DeviceOrientationEvent)) {
    void DeviceOrientationEvent.requestPermission().then(nothing, nothing);
  }
};
