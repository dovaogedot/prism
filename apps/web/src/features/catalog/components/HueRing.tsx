/**
 * A color wheel you select an arc of.
 *
 * Hue is a circle, so a linear slider is the wrong instrument for it: it puts
 * a seam at 0° and makes "the reds" — which live either side of that seam —
 * impossible to select in one gesture. On a ring it is one drag.
 *
 * Three interactions: drag either end to resize the arc, drag the arc itself
 * to rotate it, click bare ring to start a fresh selection there.
 *
 * The ring is a CSS conic-gradient masked into an annulus. The selected arc is
 * the same gradient with a second conic mask over it, composited with
 * `intersect` — so the highlight is the real color rather than an
 * approximation of it.
 */

import type { NumericRange } from "@prism/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

const SIZE = 184;
const THICKNESS = 26;
const RADIUS = (SIZE - THICKNESS) / 2;

/** The wheel, starting at red at the top and running clockwise. */
const WHEEL_GRADIENT =
  "conic-gradient(from 0deg, hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))";

/** Punches the hole that turns a disc into a ring. */
const RING_MASK = `radial-gradient(farthest-side, transparent calc(100% - ${THICKNESS}px), #000 calc(100% - ${THICKNESS}px))`;

const spanOf = (range: NumericRange): number =>
  (range.max - range.min + 360) % 360;

/** Screen position of an angle, measured clockwise from the top. */
const pointAt = (degrees: number, radius: number) => {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: SIZE / 2 + radius * Math.sin(radians),
    y: SIZE / 2 - radius * Math.cos(radians),
  };
};

/** The arc currently selected, and where to report a new one. */
export type HueRingProps = Readonly<{
  /** `None` is expressed as an inactive ring; the caller owns that decision. */
  value: NumericRange;
  active: boolean;
  onChange: (next: NumericRange) => void;
  onActivate: (next: NumericRange) => void;
  /**
   * Every intermediate value, including the ones mid-drag that never reach the
   * URL. The saturation and lightness ramps are painted in the selected hue,
   * and waiting for the drag to end would leave them a gesture behind.
   */
  onPreview: (next: NumericRange) => void;
}>;

type Grab =
  | { kind: "none" }
  | { kind: "start" }
  | { kind: "end" }
  | { kind: "rotate"; grabbedAt: number; from: NumericRange };

/**
 * The hue wheel, whose selected arc is dragged by either end or turned whole.
 *
 * The arc may wrap through 0°, since that is where the reds are.
 */
export const HueRing = ({
  value,
  active,
  onChange,
  onActivate,
  onPreview,
}: HueRingProps) => {
  const ringRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<NumericRange>(value);
  const [grab, setGrab] = useState<Grab>({ kind: "none" });

  /**
   * A ref, not `grab.kind`, for the same reason as in RangeSlider: keying the
   * sync on the grab state would re-run it on release, while `value` is still
   * the pre-navigation prop, and the arc would snap back for a frame.
   */
  const grabbingRef = useRef(false);

  useEffect(() => {
    if (grabbingRef.current) return;
    setDraft(value);
  }, [value.min, value.max]);

  /** Pointer position as an angle, clockwise from the top. */
  const angleAt = useCallback((clientX: number, clientY: number): number => {
    const ring = ringRef.current;
    if (ring === null) return 0;

    const bounds = ring.getBoundingClientRect();
    const dx = clientX - (bounds.left + bounds.width / 2);
    const dy = clientY - (bounds.top + bounds.height / 2);

    return Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360);
  }, []);

  const beginDrag = (next: Grab) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    grabbingRef.current = true;
    setGrab(next);
  };

  /** Every draft the user produces is also announced upwards, live. */
  const applyDraft = (next: NumericRange): void => {
    setDraft(next);
    onPreview(next);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (grab.kind === "none") return;

    const angle = angleAt(event.clientX, event.clientY);

    applyDraft(
      match(grab)
        .with({ kind: "start" }, () => ({ min: angle, max: draft.max }))
        .with({ kind: "end" }, () => ({ min: draft.min, max: angle }))
        .with({ kind: "rotate" }, ({ grabbedAt, from }) => {
          // Rotating preserves the span, so the arc keeps its width as it
          // travels — including across the 0° seam.
          const delta = (angle - grabbedAt + 360) % 360;
          return {
            min: (from.min + delta) % 360,
            max: (from.max + delta) % 360,
          };
        })
        // "none" was excluded by the guard above, so these three are the whole
        // remaining union.
        .exhaustive(),
    );
  };

  const endDrag = (event: React.PointerEvent) => {
    if (grab.kind === "none") return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    grabbingRef.current = false;
    setGrab({ kind: "none" });
    onChange(draft);
  };

  /** Clicking bare ring starts a 60° selection centered where you clicked. */
  const onRingPointerDown = (event: React.PointerEvent) => {
    const angle = angleAt(event.clientX, event.clientY);
    const fresh = { min: (angle - 30 + 360) % 360, max: (angle + 30) % 360 };

    applyDraft(fresh);
    onActivate(fresh);
  };

  const nudge = (thumb: "min" | "max") => (event: React.KeyboardEvent) => {
    const current = thumb === "min" ? draft.min : draft.max;

    const next = match(event.key)
      .with("ArrowLeft", "ArrowDown", () => current - 1)
      .with("ArrowRight", "ArrowUp", () => current + 1)
      .with("PageDown", () => current - 15)
      .with("PageUp", () => current + 15)
      .otherwise(() => current);

    if (next === current) return;

    event.preventDefault();
    const wrapped = (next + 360) % 360;
    const updated =
      thumb === "min" ? { min: wrapped, max: draft.max } : { min: draft.min, max: wrapped };

    applyDraft(updated);
    onChange(updated);
  };

  const span = spanOf(draft);
  const start = pointAt(draft.min, RADIUS);
  const end = pointAt(draft.max, RADIUS);

  /** Masks the wheel down to just the selected arc. */
  const arcMask = `conic-gradient(from ${draft.min}deg, #000 0deg ${span}deg, transparent ${span}deg 360deg)`;

  const thumbClass =
    "absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-[3px] border-surface bg-ink shadow-lg transition-transform hover:scale-110 active:cursor-grabbing active:scale-110";

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={ringRef}
        className="relative touch-none select-none"
        style={{ width: SIZE, height: SIZE }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* The wheel. Dimmed while a selection is active so the arc stands out. */}
        <button
          type="button"
          aria-label="Select a hue range"
          onPointerDown={onRingPointerDown}
          className="absolute inset-0 cursor-crosshair rounded-full transition-opacity"
          style={{
            backgroundImage: WHEEL_GRADIENT,
            maskImage: RING_MASK,
            WebkitMaskImage: RING_MASK,
            opacity: active ? 0.28 : 1,
          }}
        />

        {match(active)
          .with(false, () => null)
          .with(true, () => (
            <>
              {/* The selected arc: the same wheel, masked twice. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{
                  backgroundImage: WHEEL_GRADIENT,
                  maskImage: `${RING_MASK}, ${arcMask}`,
                  maskComposite: "intersect",
                  WebkitMaskImage: `${RING_MASK}, ${arcMask}`,
                  WebkitMaskComposite: "source-in",
                }}
              />

              {/* Grab anywhere on the arc to rotate the whole selection. */}
              <div
                role="button"
                aria-label="Rotate the hue range"
                tabIndex={-1}
                onPointerDown={(event) =>
                  beginDrag({
                    kind: "rotate",
                    grabbedAt: angleAt(event.clientX, event.clientY),
                    from: draft,
                  })(event)
                }
                className="absolute inset-0 cursor-move rounded-full"
                style={{
                  maskImage: `${RING_MASK}, ${arcMask}`,
                  maskComposite: "intersect",
                  WebkitMaskImage: `${RING_MASK}, ${arcMask}`,
                  WebkitMaskComposite: "source-in",
                }}
              />

              <div
                {...{
                  role: "slider",
                  tabIndex: 0,
                  "aria-label": "Hue range start",
                  "aria-valuemin": 0,
                  "aria-valuemax": 360,
                  "aria-valuenow": draft.min,
                  "aria-valuetext": `${draft.min} degrees`,
                }}
                onPointerDown={beginDrag({ kind: "start" })}
                onKeyDown={nudge("min")}
                className={thumbClass}
                style={{ left: start.x, top: start.y }}
              />

              <div
                {...{
                  role: "slider",
                  tabIndex: 0,
                  "aria-label": "Hue range end",
                  "aria-valuemin": 0,
                  "aria-valuemax": 360,
                  "aria-valuenow": draft.max,
                  "aria-valuetext": `${draft.max} degrees`,
                }}
                onPointerDown={beginDrag({ kind: "end" })}
                onKeyDown={nudge("max")}
                className={thumbClass}
                style={{ left: end.x, top: end.y }}
              />
            </>
          ))
          .exhaustive()}

        {/* The center reads out the selection, and clears it. */}
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {match(active)
            .with(true, () => (
              <div className="text-center">
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {draft.min}° – {draft.max}°
                </p>
                <p className="text-[11px] text-ink-faint">{span}° arc</p>
              </div>
            ))
            .with(false, () => (
              <p className="max-w-24 text-center text-[11px] leading-tight text-ink-faint">
                Click the ring to pick a hue range
              </p>
            ))
            .exhaustive()}
        </div>
      </div>
    </div>
  );
};
