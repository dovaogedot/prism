/**
 * A finisher, rendered as a room with its effect demonstrated in it.
 *
 * The picture is `../artwork/finisher-scene.ts` and the movement is
 * `../artwork/movement.ts`. What is left here is the part that is genuinely a
 * component: owning a canvas, turning the pointer into whatever this room
 * reads, and running the frames between where the room is and where it is
 * wanted. Which of the three rooms it is never appears in here.
 *
 * The mesh the rooms are built around arrives over the network, so a stage can
 * open before there is anything to stand in it. Until then it shows the
 * photograph the shop already has, over a canvas that is already the size it
 * will be — so what arrives replaces a picture rather than filling a gap, and
 * a grid of these never moves under the reader.
 *
 * None of the movement goes through React state, for the reason `ColorStage`
 * keeps its own out: a dozen of these are on screen and only one is ever
 * moving.
 */

import { Option, type FinishApplication, type ProductImage } from "@prism/shared";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { match } from "ts-pattern";
import { usePrefersStillness } from "../../../shared/motion/use-stillness.ts";
import { openStage, type Stage } from "../artwork/finisher-scene.ts";
import { studio } from "../artwork/gl.ts";
import { meshNow, whenMesh } from "../artwork/mesh.ts";
import {
  advanced,
  aimedAt,
  atRest,
  released,
  stilled,
  stopped,
  viewOf,
  type Movement,
} from "../artwork/movement.ts";
import { Photograph } from "./Photograph.tsx";

/**
 * What the stage is showing.
 *
 * `Waiting` and `Still` both show the photograph. What differs is whether
 * there is a canvas under it that may yet come to life: a browser that cannot
 * draw one never gets one, so nothing on the page announces a picture that is
 * never going to be there.
 */
type Showing =
  | Readonly<{ _tag: "Waiting" }>
  | Readonly<{ _tag: "Rendered" }>
  | Readonly<{ _tag: "Still" }>;

const WAITING: Showing = { _tag: "Waiting" };
const RENDERED: Showing = { _tag: "Rendered" };
const STILL: Showing = { _tag: "Still" };

/** Which finisher to demonstrate, and what to call it for a reader who cannot see it. */
export type FinisherStageProps = Readonly<{
  /** The one thing this finisher does to a surface, and how much of it. */
  application: FinishApplication;
  /** The photograph of the same finisher, shown wherever the room cannot be. */
  image: Option<ProductImage>;
  alt: string;
  className?: string;
}>;

/** A finisher's room, or the photograph of one where nothing can draw it. */
export const FinisherStage = ({
  application,
  image,
  alt,
  className = "",
}: FinisherStageProps) => {
  const still = usePrefersStillness();
  const [showing, setShowing] = useState<Showing>(WAITING);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stage = useRef<Option<Stage>>(Option.none);

  /** Read inside the frame loop, which outlives the render that started it. */
  const moving = useRef<Movement>(atRest(application));

  const frame = useRef<Option<number>>(Option.none);
  const lastFrameAt = useRef(0);

  const drawNow = (): void =>
    Option.match<Stage, void>({
      onSome: (open) => open.draw(viewOf(moving.current)),
      onNone: () => undefined,
    })(stage.current);

  /**
   * One frame of the room traveling toward the pointer.
   *
   * It stops itself: once everything has arrived the room is put exactly on
   * its target and no further frame is asked for, so a page of stages nobody
   * is pointing at costs nothing at all.
   */
  const step = (now: number): void => {
    const elapsed = (now - lastFrameAt.current) / 1000;
    lastFrameAt.current = now;

    const next = advanced(moving.current, elapsed);
    const arrived = stilled(next);

    moving.current = arrived ? stopped(next) : next;
    drawNow();

    frame.current = arrived ? Option.none : Option.some(requestAnimationFrame(step));
  };

  const startMoving = (): void => {
    if (Option.isSome(frame.current)) return;

    lastFrameAt.current = performance.now();
    frame.current = Option.some(requestAnimationFrame(step));
  };

  /**
   * A finger is not a pointer in the sense this needs: it arrives already on
   * the stage, drags the page rather than traveling over it, and leaves
   * without a `pointerleave` to put the room back. So a touch moves nothing.
   */
  const aimAt = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();

    moving.current =
      still || event.pointerType === "touch"
        ? released(moving.current)
        : aimedAt(
            moving.current,
            { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
            bounds,
          );

    startMoving();
  };

  useEffect(() => {
    // Asked before the canvas is, because it is the cheap half of the answer:
    // a browser with no WebGL2 says so without a mesh being fetched for it.
    if (Option.isNone(studio())) {
      setShowing(STILL);
      return undefined;
    }

    /**
     * Take the canvas, if there is a room to put on it yet.
     *
     * Run once now and again when the mesh lands. A room that cannot be built
     * with the mesh in hand is one that never will be, and gives up.
     */
    const attempt = (): void =>
      Option.match<Stage, void>({
        onSome: (open) => {
          stage.current = Option.some(open);
          open.draw(viewOf(moving.current));
          setShowing(RENDERED);
        },
        onNone: () => setShowing(Option.isSome(meshNow()) ? STILL : WAITING),
      })(Option.flatMap(openStage)(Option.fromNullable(canvasRef.current)));

    attempt();
    const forget = whenMesh(attempt);

    return () => {
      forget();

      Option.match<number, void>({
        onSome: (pending) => cancelAnimationFrame(pending),
        onNone: () => undefined,
      })(frame.current);
      frame.current = Option.none;

      Option.match<Stage, void>({
        onSome: (open) => open.close(),
        onNone: () => undefined,
      })(stage.current);
      stage.current = Option.none;
    };
    // Opened once. A card showing a different product is a different card, so
    // the canvas never has to be handed back and taken out again.
  }, []);

  // Rebuild and repaint where the finisher changed under a stage already open.
  useEffect(() => {
    moving.current = atRest(application);
    drawNow();
  }, [application]);

  return (
    <div
      className={`stage ${className}`}
      onPointerMove={aimAt}
      onPointerLeave={() => {
        moving.current = released(moving.current);
        startMoving();
      }}
    >
      {match(showing)
        .with({ _tag: "Still" }, () => null)
        .with({ _tag: "Rendered" }, () => (
          <canvas ref={canvasRef} role="img" aria-label={alt} className="stage__canvas" />
        ))
        .with({ _tag: "Waiting" }, () => (
          // Nothing has been drawn on it yet, and an empty picture is not one
          // a reader should be told about.
          <canvas ref={canvasRef} aria-hidden className="stage__canvas" />
        ))
        .exhaustive()}

      {match(showing)
        .with({ _tag: "Rendered" }, () => null)
        .otherwise(() => <Photograph image={image} alt={alt} className="stage__still" />)}
    </div>
  );
};
