/**
 * A two-thumb range slider.
 *
 * Dragging updates a local draft and only reports on release, so a drag
 * across the track produces one navigation rather than sixty.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

/** A span on a numeric axis, `min` never above `max`. */
export type Range = Readonly<{ min: number; max: number }>;

export const Range = {
  clamp: (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value)),
} as const;

/** The axis, the span selected on it, and where to report a new one. */
export type RangeSliderProps = Readonly<{
  label: string;
  min: number;
  max: number;
  step?: number;
  value: Range;
  onChange: (next: Range) => void;
  format: (value: number) => string;
}>;

type Thumb = "min" | "max";

/** Two thumbs on one track. They may meet but never cross. */
export const RangeSlider = ({ label, min, max, step = 1, value, onChange, format }: RangeSliderProps) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Range>(value);
  const [dragging, setDragging] = useState<Thumb | "none">("none");

  /**
   * Whether a drag is live, as a ref: keyed on `value` alone, the sync below
   * fires once when the new value arrives rather than snapping the thumb back
   * for a frame on release while the URL has not round-tripped yet.
   */
  const draggingRef = useRef(false);

  // Follow the value when it changes from somewhere else: a Clear button, the
  // back button, or the parent normalizing what was just sent.
  useEffect(() => {
    if (draggingRef.current) return;
    setDraft(value);
  }, [value.min, value.max]);

  const valueAt = useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (track === null) return min;

      const bounds = track.getBoundingClientRect();
      const ratio = Range.clamp((clientX - bounds.left) / bounds.width, 0, 1);

      return Math.round((min + ratio * (max - min)) / step) * step;
    },
    [min, max, step],
  );

  const moveThumb = useCallback(
    (thumb: Thumb, next: number): Range =>
      thumb === "min"
        ? { min: Range.clamp(next, min, draft.max), max: draft.max }
        : { min: draft.min, max: Range.clamp(next, draft.min, max) },
    [draft.min, draft.max, min, max],
  );

  const startDrag = (thumb: Thumb) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setDragging(thumb);
  };

  const onPointerMove = (thumb: Thumb) => (event: React.PointerEvent) => {
    if (dragging !== thumb) return;
    setDraft(moveThumb(thumb, valueAt(event.clientX)));
  };

  const endDrag = (event: React.PointerEvent) => {
    if (dragging === "none") return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    draggingRef.current = false;
    setDragging("none");
    onChange(draft);
  };

  /** Keyboard commits immediately: there is no drag to wait for. */
  const onKeyDown = (thumb: Thumb) => (event: React.KeyboardEvent) => {
    const current = thumb === "min" ? draft.min : draft.max;
    const big = Math.max(step, Math.round((max - min) / 10));

    const next = match(event.key)
      .with("ArrowLeft", "ArrowDown", () => current - step)
      .with("ArrowRight", "ArrowUp", () => current + step)
      .with("PageDown", () => current - big)
      .with("PageUp", () => current + big)
      .with("Home", () => min)
      .with("End", () => max)
      .otherwise(() => current);

    if (next === current) return;

    event.preventDefault();
    const updated = moveThumb(thumb, Range.clamp(next, min, max));
    setDraft(updated);
    onChange(updated);
  };

  const ratio = (at: number): string => `${max === min ? 0 : ((at - min) / (max - min)) * 100}%`;

  const thumbProps = (thumb: Thumb) => {
    const current = thumb === "min" ? draft.min : draft.max;

    return {
      role: "slider" as const,
      tabIndex: 0,
      "aria-label": `${label}, ${thumb === "min" ? "minimum" : "maximum"}`,
      "aria-valuemin": thumb === "min" ? min : draft.min,
      "aria-valuemax": thumb === "min" ? draft.max : max,
      "aria-valuenow": current,
      "aria-valuetext": format(current),
      onPointerDown: startDrag(thumb),
      onPointerMove: onPointerMove(thumb),
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown: onKeyDown(thumb),
      style: { left: ratio(current) },
      className:
        "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none rounded-full border-2 border-surface bg-ink shadow-md transition-transform hover:scale-110 active:cursor-grabbing active:scale-110",
    };
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-faint">{label}</span>
        <span className="font-medium tabular-nums text-ink">
          {format(draft.min)} – {format(draft.max)}
        </span>
      </div>

      <div className="px-2 py-2">
        <div ref={trackRef} className="relative h-2 rounded-full border border-line bg-sunken">
          {/* The chosen span, so the selection reads at a glance. */}
          <div
            className="pointer-events-none absolute inset-y-0 rounded-full bg-accent"
            style={{ left: ratio(draft.min), right: `${100 - Number.parseFloat(ratio(draft.max))}%` }}
          />

          <div {...thumbProps("min")} />
          <div {...thumbProps("max")} />
        </div>
      </div>
    </div>
  );
};
