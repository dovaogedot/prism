/**
 * A color, rendered as an object standing in a room.
 *
 * The picture itself is `../artwork/scene.ts` — one WebGL context that every
 * stage on the page shares. What is left here is the part that is genuinely a
 * component: owning a canvas, turning the pointer into an angle, and running
 * the frames between the angle the slab is at and the angle it is wanted at.
 *
 * None of that goes through React state. A dozen of these are on screen and
 * only one is ever moving, and re-rendering a card's subtree sixty times a
 * second to change a number no React tree reads is not what React is for.
 */

import { Option, type ProductImage } from "@prism/shared";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { match } from "ts-pattern";
import { openStage, type Stage } from "../artwork/scene.ts";
import type { Finishing } from "../artwork/surfaces.ts";
import { approach, REST, settled, tiltAt, type Tilt } from "../artwork/tilt.ts";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Whether the visitor has asked for less movement.
 *
 * The slab simply stays square on for them. Cutting the easing instead would
 * leave it snapping from angle to angle under the pointer, which is the one
 * thing worse than the animation.
 */
const usePrefersStillness = (): boolean => {
  const [still, setStill] = useState(() => window.matchMedia(REDUCED_MOTION).matches);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION);
    const onChange = (): void => setStill(query.matches);

    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return still;
};

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
      onSome: (open) => open.draw({ ...paint.current, tilt }),
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
   * A finger is not a pointer in the sense this needs: it arrives already on
   * the slab, drags the page rather than traveling over it, and leaves without
   * a `pointerleave` to put the slab back. So a touch turns nothing.
   */
  const aimAt = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();

    target.current =
      still || event.pointerType === "touch"
        ? REST
        : tiltAt(
            { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
            bounds,
          );

    startMoving();
  };

  useEffect(() => {
    const opened = Option.flatMap(openStage)(Option.fromNullable(canvasRef.current));
    stage.current = opened;

    Option.match<Stage, void>({
      onSome: (open) => open.draw({ hex, finishing, tilt: REST }),
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

  return (
    <div
      className={`stage ${className}`}
      onPointerMove={aimAt}
      onPointerLeave={() => {
        target.current = REST;
        startMoving();
      }}
    >
      {match(showing)
        .with({ _tag: "Rendered" }, () => (
          <canvas ref={canvasRef} role="img" aria-label={alt} className="stage__canvas" />
        ))
        .with({ _tag: "Flat" }, () =>
          match(image)
            .with({ _tag: "Some" }, ({ value }) => (
              <img
                src={value.url}
                alt={value.alt.length > 0 ? value.alt : alt}
                loading="lazy"
                decoding="async"
                className="stage__flat"
              />
            ))
            .with({ _tag: "None" }, () => (
              <div
                role="img"
                aria-label={alt}
                className="stage__flat"
                style={{ backgroundColor: hex }}
              />
            ))
            .exhaustive(),
        )
        .exhaustive()}

      {match(caption)
        .with(undefined, () => null)
        .otherwise((text) => (
          // A placard beside the work rather than a label on it: the slab is
          // the product, and printing on the product is not what a shop does.
          <span className="stage__placard">{text}</span>
        ))}
    </div>
  );
};
