/**
 * A color, rendered as an object standing in a room.
 *
 * The picture itself is `../artwork/scene.ts` — one WebGL context that every
 * stage on the page shares. What is left here is the part that is genuinely a
 * component: owning a canvas, turning the pointer or the phone's tilt into an
 * angle, and running the frames between the angle the slab is at and the
 * angle it is wanted at.
 *
 * None of that goes through React state. A dozen of these are on screen and
 * only one is ever moving, and re-rendering a card's subtree sixty times a
 * second to change a number no React tree reads is not what React is for.
 */

import { Option, type ProductImage } from "@prism/shared";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { match } from "ts-pattern";
import { usePrefersStillness } from "../../../shared/motion/use-stillness.ts";
import { askForTilt, followTilt, tilting } from "../artwork/gyro.ts";
import { pointAt } from "../artwork/pointer.ts";
import { openStage, type Stage } from "../artwork/scene.ts";
import type { Finishing } from "../artwork/surfaces.ts";
import { approach, REST, settled, tiltAt, type Tilt } from "../artwork/tilt.ts";
import { AT_REST } from "../artwork/viewpoint.ts";
import { Placard } from "./Placard.tsx";
import { Swatch } from "./Swatch.tsx";

/**
 * What the stage is showing.
 *
 * A browser with no WebGL2 is not an error to handle — it is a second, worse
 * picture to draw. It still gets the right color, which is the part the shop
 * is selling.
 */
type Showing = Readonly<{ _tag: "Rendered" }> | Readonly<{ _tag: "Flat" }>;

const RENDERED: Showing = { _tag: "Rendered" };
const FLAT: Showing = { _tag: "Flat" };

/** Which color to light, and what to call it for a reader who cannot see it. */
export type ColorStageProps = Readonly<{
  hex: string;
  /** The three amounts of finish this color carries. */
  finishing: Finishing;
  image: Option<ProductImage>;
  alt: string;
  /** Colors on a card show their hex on a placard; the product page does not. */
  caption?: string;
  className?: string;
}>;

/** A lit slab of one color, or a flat swatch of it where nothing can draw one. */
export const ColorStage = ({
  hex,
  finishing,
  image,
  alt,
  caption,
  className = "",
}: ColorStageProps) => {
  const still = usePrefersStillness();
  const [showing, setShowing] = useState<Showing>(RENDERED);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Option<Stage>>(Option.none);

  /** Read inside the frame loop, which outlives the render that started it. */
  const paint = useRef({ hex, finishing });

  const target = useRef<Tilt>(REST);
  const standing = useRef<Tilt>(REST);
  const frame = useRef<Option<number>>(Option.none);
  const lastFrameAt = useRef(0);

  const drawAt = (tilt: Tilt): void =>
    Option.match<Stage, void>({
      onSome: (open) => open.draw({ ...paint.current, tilt, viewpoint: AT_REST }),
      onNone: () => undefined,
    })(stage.current);

  /**
   * One frame of the slab traveling toward the pointer.
   *
   * It stops itself: once the remaining angle is under the threshold the slab
   * is put exactly on its target and no further frame is asked for, so a page
   * of stages nobody is pointing at costs nothing at all.
   */
  const step = (now: number): void => {
    const elapsed = (now - lastFrameAt.current) / 1000;
    lastFrameAt.current = now;

    const next = approach(standing.current, target.current, elapsed);
    const arrived = settled(next, target.current);

    standing.current = arrived ? target.current : next;
    drawAt(standing.current);

    frame.current = arrived ? Option.none : Option.some(requestAnimationFrame(step));
  };

  const startMoving = (): void => {
    if (Option.isSome(frame.current)) return;

    lastFrameAt.current = performance.now();
    frame.current = Option.some(requestAnimationFrame(step));
  };

  /**
   * Turn the slab toward where the pointer or the finger is over it.
   *
   * A finger turns it while it is down, on a phone that reports no tilt; where
   * one does, the tilt turns it and a finger is left to the page. The stage
   * leaves a drag up or down to the page, so a finger drawn sideways turns the
   * slab and one drawn up or down scrolls past it. Lifting the finger puts the
   * slab back, the same as a pointer leaving.
   */
  const aimAt = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch" && tilting()) return;

    const bounds = event.currentTarget.getBoundingClientRect();

    target.current = still
      ? REST
      : tiltAt({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, bounds);

    startMoving();
  };

  /** Put the slab back as the pointer leaves, unless the tilt is what turns it. */
  const letGo = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === "touch" && tilting()) return;

    target.current = REST;
    startMoving();
  };

  // Turned by the phone's tilt while the stage is on screen. Off screen it
  // follows nothing, so a tilt redraws only the stages somebody can see.
  useEffect(() => {
    const element = stageRef.current;

    if (still || element === null) return undefined;

    let forget = (): void => undefined;

    const observer = new IntersectionObserver((entries) => {
      forget();
      forget =
        entries.at(-1)?.isIntersecting === true
          ? followTilt((lean) => {
              const bounds = element.getBoundingClientRect();

              target.current = tiltAt(pointAt(lean, bounds), bounds);
              startMoving();
            })
          : () => undefined;
    });

    observer.observe(element);

    return () => {
      observer.disconnect();
      forget();
    };
  }, [still, showing]);

  useEffect(() => {
    const opened = Option.flatMap(openStage)(Option.fromNullable(canvasRef.current));
    stage.current = opened;

    Option.match<Stage, void>({
      onSome: (open) => open.draw({ hex, finishing, tilt: REST, viewpoint: AT_REST }),
      onNone: () => setShowing(FLAT),
    })(opened);

    return () => {
      Option.match<number, void>({
        onSome: (pending) => cancelAnimationFrame(pending),
        onNone: () => undefined,
      })(frame.current);
      frame.current = Option.none;

      Option.match<Stage, void>({
        onSome: (open) => open.close(),
        onNone: () => undefined,
      })(opened);
      stage.current = Option.none;
    };
    // Opened once. A card showing a different product is a different card,
    // so the canvas never has to be handed back and taken out again.
  }, []);

  // Repaint where the paint changed under a stage that is already open.
  useEffect(() => {
    paint.current = { hex, finishing };
    drawAt(standing.current);
  }, [hex, finishing]);

  return match(showing)
    .with({ _tag: "Flat" }, () => (
      <Swatch
        hex={hex}
        image={image}
        alt={alt}
        {...(caption === undefined ? {} : { caption })}
        className={className}
      />
    ))
    .with({ _tag: "Rendered" }, () => (
      <div
        ref={stageRef}
        className={`stage ${className}`}
        onPointerDown={aimAt}
        onPointerMove={aimAt}
        onPointerLeave={letGo}
        // A finger lifting is something the visitor did, which is when a
        // browser that asks before reporting a tilt lets the page ask.
        onPointerUp={(event) => {
          if (event.pointerType !== "mouse") askForTilt();
        }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={alt}
          className="stage__canvas"
        />

        <Placard caption={Option.fromNullable(caption)} />
      </div>
    ))
    .exhaustive();
};
