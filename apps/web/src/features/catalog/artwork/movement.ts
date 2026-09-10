/**
 * What the pointer has done to a finisher's room.
 *
 * Every room has exactly one thing in it that moves, and each of them moves
 * for its own reason: a roughness room turns the ring of lamps around its
 * subject, a glowing room walks the eye through the dark, and a coated room
 * carries every hue in it around the wheel. This holds all three as one value
 * — what is being demonstrated, where its movement has got to, and where the
 * pointer is asking it to go — so a component that owns a canvas runs the same
 * few steps whichever room it was handed.
 *
 * Pure, and nothing here knows about a canvas or a frame: a movement goes in,
 * a movement comes out, and `viewOf` says what to draw of the result.
 */

import type { FinishApplication } from "@prism/shared";
import { match } from "ts-pattern";
import { CORNER_BEARING } from "./arrangement.ts";
import { arrived, SETTLE_SECONDS, toward } from "./ease.ts";
import type { FinisherView } from "./finisher-scene.ts";
import { hueOffsetAt, SETTLED_DEGREES, unturned } from "./hueshift.ts";
import { formed, lagged, LAGS, restingAt, type Lamp } from "./lightring.ts";
import {
  approachOrbit,
  orbitAt,
  orbitSettled,
  REST_ORBIT,
  turnedBy,
  type Orbit,
} from "./orbit.ts";
import type { Point, Size } from "./pointer.ts";
import { LAMP_RADIUS, RING_AT_REST } from "./rooms.ts";

/**
 * Where a coated room's wheel sits with nothing pointed at it.
 *
 * Not carried at all, so a room at rest shows the hues it is painted. The
 * pointer only ever adds to that, and crossing the whole stage adds a full
 * turn — which brings the same hues back.
 */
const REST_HUE = 0;

/** One finisher's room: what it demonstrates, and where its movement stands. */
export type Movement =
  | Readonly<{
      applies: "roughness";
      /** 5 is a mirror, 95 is chalk. */
      roughness: number;
      /** Where the lamps have got to, each at its own lag. */
      lamps: readonly Lamp[];
      /** The ring the pointer is asking them to form. */
      wanted: Orbit;
    }>
  | Readonly<{
      applies: "emission";
      /** How hard the pigment gives off its own light, out of 100. */
      emission: number;
      /** Where the eye has got to. */
      orbit: Orbit;
      /** Where the pointer is asking it to stand. */
      wanted: Orbit;
    }>
  | Readonly<{
      applies: "coating";
      /** Nanometers of interference coating. */
      coatingNanometers: number;
      /** How far around the wheel every hue has been carried, in degrees. */
      hueOffset: number;
      /** How far the pointer is asking them to be carried. */
      wanted: number;
    }>;

/**
 * A room standing still, showing this finisher.
 *
 * Where a stage opens: everything is already on its target, so `stilled` holds
 * and the first frame is the only one drawn until a pointer arrives.
 */
export const atRest = (application: FinishApplication): Movement =>
  match(application)
    .with({ applies: "roughness" }, ({ roughness }) => ({
      applies: "roughness" as const,
      roughness,
      lamps: restingAt(LAGS, RING_AT_REST, LAMP_RADIUS),
      wanted: RING_AT_REST,
    }))
    .with({ applies: "emission" }, ({ emission }) => ({
      applies: "emission" as const,
      emission,
      orbit: REST_ORBIT,
      wanted: REST_ORBIT,
    }))
    .with({ applies: "coating" }, ({ coatingNanometers }) => ({
      applies: "coating" as const,
      coatingNanometers,
      hueOffset: REST_HUE,
      wanted: REST_HUE,
    }))
    .exhaustive();

/**
 * The same movement, now traveling toward where the pointer is over the stage.
 *
 * Only the target moves. What the room is showing and where it has got to are
 * carried through untouched, which is what lets the pointer be read on every
 * event without restarting the travel.
 */
export const aimedAt = (movement: Movement, pointer: Point, stage: Size): Movement =>
  match(movement)
    .with({ applies: "roughness" }, (rough) => ({
      ...rough,
      wanted: turnedBy(orbitAt(pointer, stage), CORNER_BEARING),
    }))
    .with({ applies: "emission" }, (glow) => ({
      ...glow,
      wanted: orbitAt(pointer, stage),
    }))
    .with({ applies: "coating" }, (coat) => ({
      ...coat,
      wanted: hueOffsetAt(pointer, stage),
    }))
    .exhaustive();

/**
 * The same movement, now traveling back to where a room nobody is pointing at
 * stands.
 *
 * What the pointer leaving the stage asks for, and what a visitor who has
 * asked for less movement gets instead of the pointer.
 */
export const released = (movement: Movement): Movement =>
  match(movement)
    .with({ applies: "roughness" }, (rough) => ({ ...rough, wanted: RING_AT_REST }))
    .with({ applies: "emission" }, (glow) => ({ ...glow, wanted: REST_ORBIT }))
    .with({ applies: "coating" }, (coat) => ({ ...coat, wanted: unturned(coat.hueOffset) }))
    .exhaustive();

/**
 * One frame of the room traveling toward its target.
 *
 * Framerate-independent, and the target is left where it was: a frame that
 * took twice as long covers twice the ground rather than moving twice as far
 * per second.
 */
export const advanced = (movement: Movement, elapsedSeconds: number): Movement =>
  match(movement)
    .with({ applies: "roughness" }, (rough) => ({
      ...rough,
      lamps: lagged(rough.lamps, rough.wanted, LAMP_RADIUS, elapsedSeconds),
    }))
    .with({ applies: "emission" }, (glow) => ({
      ...glow,
      orbit: approachOrbit(glow.orbit, glow.wanted, elapsedSeconds),
    }))
    .with({ applies: "coating" }, (coat) => ({
      ...coat,
      hueOffset: toward(coat.hueOffset, coat.wanted, elapsedSeconds, SETTLE_SECONDS),
    }))
    .exhaustive();

/** Whether the room has arrived where it was going, and the frames can stop. */
export const stilled = (movement: Movement): boolean =>
  match(movement)
    .with({ applies: "roughness" }, (rough) => formed(rough.lamps, rough.wanted, LAMP_RADIUS))
    .with({ applies: "emission" }, (glow) => orbitSettled(glow.orbit, glow.wanted))
    .with({ applies: "coating" }, (coat) => arrived(coat.hueOffset, coat.wanted, SETTLED_DEGREES))
    .exhaustive();

/**
 * The room put exactly on its target, which is where it comes to rest.
 *
 * Exponential travel never quite arrives, so the last frame lands on the
 * target outright: a ring that stops a thousandth short of formation is a
 * ring that is not regular, and it stays that way until something moves again.
 */
export const stopped = (movement: Movement): Movement =>
  match(movement)
    .with({ applies: "roughness" }, (rough) => ({
      ...rough,
      lamps: restingAt(LAGS, rough.wanted, LAMP_RADIUS),
    }))
    .with({ applies: "emission" }, (glow) => ({ ...glow, orbit: glow.wanted }))
    .with({ applies: "coating" }, (coat) => ({ ...coat, hueOffset: coat.wanted }))
    .exhaustive();

/**
 * The picture this room makes, as the renderer wants it.
 *
 * Nothing about a product but the amount it carries reaches the picture: the
 * paint on the subjects belongs to the room, so two finishers in the same room
 * differ by what they do to a surface and by nothing else.
 */
export const viewOf = (movement: Movement): FinisherView =>
  match(movement)
    .with({ applies: "roughness" }, ({ roughness, lamps }) => ({
      applies: "roughness" as const,
      roughness,
      lamps,
    }))
    .with({ applies: "emission" }, ({ emission, orbit }) => ({
      applies: "emission" as const,
      emission,
      orbit,
    }))
    .with({ applies: "coating" }, ({ coatingNanometers, hueOffset }) => ({
      applies: "coating" as const,
      coatingNanometers,
      hueOffset,
    }))
    .exhaustive();
