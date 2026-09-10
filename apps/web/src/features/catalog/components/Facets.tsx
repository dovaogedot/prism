/**
 * The filter rail.
 *
 * Two rules shape it. Nothing ever disappears — a bucket that matches nothing
 * is struck through and disabled rather than removed, so the rail never
 * reflows under the pointer. And the color filters are shaped like the thing
 * they filter: a ring for hue, a saturation ramp for saturation, black-to-white
 * for lightness.
 */

import {
  ARC_BOUNDS,
  DIRECTION_LABELS,
  formatPrice,
  isCents,
  LIGHTNESS_BOUNDS,
  Option,
  SATURATION_BOUNDS,
  SHIFT_DIRECTIONS,
  type FacetBucket,
  type FinishBand,
  type NumericRange,
  type ProductFacets,
  type ShiftDirection,
} from "@prism/shared";
import { useState, type ReactNode } from "react";
import { match, P } from "ts-pattern";
import { railControls, type FacetState } from "../filters.ts";
import { HueRing } from "./HueRing.tsx";
import { RangeSlider } from "./RangeSlider.tsx";

/** The choices on offer, the ones taken, and where a change goes. */
export type FacetsProps = Readonly<{
  facets: ProductFacets;
  state: FacetState;
  onChange: (next: Partial<FacetState>) => void;
  onReset: () => void;
}>;

/* ------------------------------------------------------------- scaffolding */

const Section = ({
  title,
  summary,
  children,
  defaultOpen = true,
}: Readonly<{
  title: string;
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}>) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="border-b border-line last:border-0">
      <h3>
        {/*
          Fixed height, and a title that cannot wrap. Without both, the badge
          appearing steals width from the title, the title wraps to a second
          line, and the whole rail below it jumps a few pixels.
        */}
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="flex h-11 w-full items-center gap-2 text-left"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className={`size-3 shrink-0 text-ink-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M5 3l6 5-6 5z" />
          </svg>

          <span className="min-w-0 flex-1 truncate whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-ink-faint">
            {title}
          </span>

          {/* What is selected, so a collapsed section is still readable. */}
          {match(summary)
            .with(P.nullish, () => null)
            .with("", () => null)
            .otherwise((text) => (
              <span className="max-w-24 shrink-0 truncate whitespace-nowrap rounded bg-accent-wash px-1.5 py-0.5 text-[10px]/[14px] font-medium text-ink">
                {text}
              </span>
            ))}
        </button>
      </h3>

      {match(open)
        .with(true, () => <div className="pb-4">{children}</div>)
        .with(false, () => null)
        .exhaustive()}
    </section>
  );
};

/**
 * A bucket that matches nothing stays put, struck through and unclickable.
 * Removing it would reflow every row beneath the pointer mid-click.
 */
const bucketClasses = (empty: boolean, selected: boolean): string =>
  [
    "flex items-center gap-2.5 rounded px-1 py-1 text-sm",
    empty
      ? "cursor-not-allowed text-ink-faint/60 line-through decoration-ink-faint/40"
      : "cursor-pointer hover:bg-sunken",
    selected && !empty ? "font-medium" : "",
  ].join(" ");

const toggle = (values: readonly string[], value: string): readonly string[] =>
  values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];

const CheckList = ({
  buckets,
  selected,
  onToggle,
  name,
}: Readonly<{
  buckets: readonly FacetBucket[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  name: string;
}>) => (
  <ul className="space-y-0.5">
    {buckets.map((bucket) => {
      // A selected-but-empty bucket must stay clickable, or there would be no
      // way to untick the filter that emptied it.
      const isSelected = selected.includes(bucket.value);
      const locked = bucket.count === 0 && !isSelected;

      return (
        <li key={bucket.value}>
          <label className={bucketClasses(locked, isSelected)}>
            <input
              type="checkbox"
              name={name}
              checked={isSelected}
              disabled={locked}
              onChange={() => onToggle(bucket.value)}
              className="size-4 shrink-0 accent-[--color-accent] disabled:opacity-40"
            />
            <span className="flex-1 truncate text-ink">{bucket.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {bucket.count}
            </span>
          </label>
        </li>
      );
    })}
  </ul>
);

/**
 * The same list, exclusive. Clicking the chosen one clears it, so a category is
 * never a one-way door.
 */
const RadioList = ({
  buckets,
  selected,
  onSelect,
  name,
  /**
   * Whether an empty bucket locks. The category list opts out: it is the first
   * filter, and choosing one clears every filter below it — so a category
   * showing zero under the current filters is still a live destination, not the
   * dead end the strike-through means everywhere else.
   */
  lockEmpty = true,
}: Readonly<{
  buckets: readonly FacetBucket[];
  selected: string;
  onSelect: (value: string) => void;
  name: string;
  lockEmpty?: boolean;
}>) => (
  <ul className="space-y-0.5">
    {buckets.map((bucket) => {
      const isSelected = selected === bucket.value;
      const locked = lockEmpty && bucket.count === 0 && !isSelected;

      return (
        <li key={bucket.value}>
          <label className={bucketClasses(locked, isSelected)}>
            <input
              type="radio"
              name={name}
              checked={isSelected}
              disabled={locked}
              // `onChange` never fires for the already-checked radio, so
              // clearing has to come from the click itself.
              onChange={() => onSelect(bucket.value)}
              onClick={() => {
                if (isSelected) onSelect("");
              }}
              className="size-4 shrink-0 accent-[--color-accent] disabled:opacity-40"
            />
            <span className="flex-1 truncate text-ink">{bucket.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-ink-faint">
              {bucket.count}
            </span>
          </label>
        </li>
      );
    })}
  </ul>
);

/**
 * Two positions and a knob that slides between them. There are exactly two
 * directions and no third, so a slider says more than two checkboxes would —
 * and clearing it is a separate button rather than a phantom middle position.
 */
const DirectionToggle = ({
  value,
  onChange,
}: Readonly<{
  value: Option<ShiftDirection>;
  onChange: (next: Option<ShiftDirection>) => void;
}>) => {
  const chosen = Option.match<ShiftDirection, ShiftDirection | "none">({
    onSome: (direction) => direction,
    onNone: () => "none",
  })(value);

  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Direction"
        className="relative flex rounded-lg border border-line bg-sunken p-0.5"
      >
        {/* The knob, moved rather than redrawn, so the two states are one control. */}
        {match(chosen)
          .with("none", () => null)
          .otherwise((direction) => (
            <span
              aria-hidden="true"
              className={`absolute inset-y-0.5 w-[calc(50%-0.125rem)] rounded-md bg-accent transition-transform duration-200 ${
                direction === "ccw" ? "translate-x-full" : ""
              }`}
            />
          ))}

        {SHIFT_DIRECTIONS.map((direction) => (
          <button
            key={direction}
            type="button"
            aria-pressed={chosen === direction}
            onClick={() => onChange(Option.some(direction))}
            className={`relative z-10 flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              chosen === direction ? "text-accent-ink" : "text-ink-soft hover:text-ink"
            }`}
          >
            {direction === "cw" ? "↻ CW" : "↺ CCW"}
          </button>
        ))}
      </div>

      {match(chosen)
        .with("none", () => (
          <p className="text-xs text-ink-faint">Either way round.</p>
        ))
        .otherwise((direction) => (
          <button
            type="button"
            onClick={() => onChange(Option.none)}
            className="w-full rounded-lg border border-line py-1.5 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink"
          >
            {DIRECTION_LABELS[direction]} — clear
          </button>
        ))}
    </div>
  );
};

/* ------------------------------------------------------------- star rating */

const Star = ({ filled }: Readonly<{ filled: boolean }>) => (
  <svg
    viewBox="0 0 20 20"
    aria-hidden="true"
    className={`size-6 transition-colors ${filled ? "text-accent" : "text-line-strong"}`}
    fill="currentColor"
  >
    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z" />
  </svg>
);

/**
 * Click a star to set the minimum rating; click the one already set to clear
 * it. Hovering previews the threshold, which is what makes it feel like a
 * rating control rather than five checkboxes.
 */
const StarRating = ({
  value,
  counts,
  onChange,
}: Readonly<{
  value: number;
  counts: ReadonlyMap<number, number>;
  onChange: (next: number) => void;
}>) => {
  const [hovered, setHovered] = useState(0);
  const shown = hovered > 0 ? hovered : value;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1" onMouseLeave={() => setHovered(0)}>
        {[1, 2, 3, 4, 5].map((threshold) => {
          const available = (counts.get(threshold) ?? 0) > 0;

          return (
            <button
              key={threshold}
              type="button"
              disabled={!available && threshold !== value}
              onMouseEnter={() => setHovered(threshold)}
              onFocus={() => setHovered(threshold)}
              onBlur={() => setHovered(0)}
              onClick={() => onChange(threshold === value ? 0 : threshold)}
              aria-label={`${threshold} star${threshold === 1 ? "" : "s"} and up`}
              aria-pressed={value === threshold}
              className="rounded transition-transform hover:scale-110 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:scale-100"
            >
              <Star filled={threshold <= shown} />
            </button>
          );
        })}
      </div>

      <p className="text-xs text-ink-faint">
        {match(shown)
          .with(0, () => "Any rating")
          .otherwise((threshold) => {
            const total = counts.get(threshold) ?? 0;
            return `${threshold}★ & up — ${total} item${total === 1 ? "" : "s"}`;
          })}
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------- rail */

/**
 * What a range section says when it is shut.
 *
 * Empty while the filter is untouched, so a closed section only ever carries a
 * summary when there is something to summarize.
 */
const rangeSummary = (
  min: string,
  max: string,
  range: NumericRange,
  format: (value: number) => string,
): string =>
  min === "" && max === "" ? "" : `${format(range.min)}–${format(range.max)}`;

/** Whether a range filter is doing anything at all. */
const hasRange = (min: string, max: string): boolean => min !== "" || max !== "";

/**
 * What a panel of several ranges says when it is shut.
 *
 * A count rather than the ranges themselves: three of them spelled out would
 * not fit on the header, and a header that can grow moves every section under
 * it when a filter is applied.
 */
const settledCount = (active: readonly boolean[]): string => {
  const count = active.filter(Boolean).length;

  return count === 0 ? "" : `${count} set`;
};

const numberOr = (raw: string, fallback: number): number =>
  raw === "" ? fallback : Number(raw);

/**
 * What a coating looks like along its range, thinnest to thickest.
 *
 * Interference color does not run round the hue wheel once. It walks a series
 * — warm, then yellow, then cyan, then magenta, then green — and starts again
 * paler each time the layer thickens past another order. The hues here were
 * sampled off rendered slabs at the thicknesses they sit at, so the track says
 * what the shelf actually holds; only the lightness is lifted, because the
 * pigment they were measured on is nearly black and a track has to be legible.
 */
const COATING_RAMP =
  "linear-gradient(to right, #cb7f71 0%, #c4d369 15%, #3de1ff 30%, #e05cbd 45%, #6fcea8 60%, #83b9a8 75%, #b48893 90%, #84b4b8 100%)";

/** Pale, then the chalk end. Reads the way the word does at either band. */
const ROUGHNESS_RAMP = "linear-gradient(to right, #f4f4f5, #6b6b70)";

/** A glow worth selling at one end, and one you cannot look at at the other. */
const EMISSION_RAMP = "linear-gradient(to right, #cdbb6a, #fde047, #fffbea)";

/**
 * Where on one amount to look, within a stretch of that amount's axis.
 *
 * The stretch is given rather than assumed, because the two shelves that ask
 * this question hold different parts of the same axis. A color carries every
 * amount there is, so its sliders run the whole of each; a shelf of finishers
 * that apply one finish only holds the stretch that finish names, and a slider
 * running past it would have a dead end a shopper can drag into.
 *
 * Roughness is the one with two names on it — dragging the low end up asks for
 * matte and dragging the high end down asks for gloss, without the shop having
 * to pick the point where one becomes the other.
 */
const AmountSlider = ({
  band,
  state,
  onChange,
}: Readonly<{
  band: FinishBand;
  state: FacetState;
  onChange: (next: Partial<FacetState>) => void;
}>) => {
  const { property, range } = band;

  /** Dragged back to an end of the band means "no narrowing", not "the band". */
  const narrowed = (next: NumericRange): Readonly<{ min: string; max: string }> => ({
    min: next.min <= range.min ? "" : String(next.min),
    max: next.max >= range.max ? "" : String(next.max),
  });

  return match(property)
    .with("roughness", () => (
      <RangeSlider
        label="Roughness"
        min={range.min}
        max={range.max}
        value={{
          min: numberOr(state.roughnessMin, range.min),
          max: numberOr(state.roughnessMax, range.max),
        }}
        format={(value) => `${value}%`}
        trackBackground={ROUGHNESS_RAMP}
        onChange={(next) =>
          onChange({
            roughnessMin: narrowed(next).min,
            roughnessMax: narrowed(next).max,
          })
        }
      />
    ))
    .with("coating", () => (
      <RangeSlider
        label="Coating"
        min={range.min}
        max={range.max}
        step={10}
        value={{
          min: numberOr(state.coatingMin, range.min),
          max: numberOr(state.coatingMax, range.max),
        }}
        format={(value) => `${value} nm`}
        trackBackground={COATING_RAMP}
        onChange={(next) =>
          onChange({
            coatingMin: narrowed(next).min,
            coatingMax: narrowed(next).max,
          })
        }
      />
    ))
    .with("emission", () => (
      <RangeSlider
        label="Emission"
        min={range.min}
        max={range.max}
        value={{
          min: numberOr(state.emissionMin, range.min),
          max: numberOr(state.emissionMax, range.max),
        }}
        format={(value) => `${value}%`}
        trackBackground={EMISSION_RAMP}
        onChange={(next) =>
          onChange({
            emissionMin: narrowed(next).min,
            emissionMax: narrowed(next).max,
          })
        }
      />
    ))
    .exhaustive();
};

/** The ring is shown in a neutral blue while no hue is selected. */
const DEFAULT_RAMP_HUE = 220;

const isDirection = (value: string): value is ShiftDirection =>
  SHIFT_DIRECTIONS.some((direction) => direction === value);

/**
 * The filter rail.
 *
 * Offers each category only the controls that category has, so switching
 * category changes which sections exist rather than graying them out. A hue
 * ring means nothing on a shelf of finishers, so with no category chosen the
 * rail is just the filters all three share.
 */
export const Facets = ({ facets, state, onChange, onReset }: FacetsProps) => {
  const priceBounds = facets.priceCents;
  const hueActive = state.hueMin !== "" || state.hueMax !== "";
  const controls = railControls(state);

  /** Which of the three axes a shopper has narrowed, for the section summary. */
  const amountsNarrowed: readonly boolean[] = [
    hasRange(state.roughnessMin, state.roughnessMax),
    hasRange(state.coatingMin, state.coatingMax),
    hasRange(state.emissionMin, state.emissionMax),
  ];

  const arc: NumericRange = {
    min: numberOr(state.arcMin, ARC_BOUNDS.min),
    max: numberOr(state.arcMax, ARC_BOUNDS.max),
  };

  const direction: Option<ShiftDirection> = isDirection(state.direction)
    ? Option.some(state.direction)
    : Option.none;

  /** The hue under the pointer, which leads the committed value while dragging. */
  const [huePreview, setHuePreview] = useState<Option<number>>(Option.none);

  const price: NumericRange = {
    min: numberOr(state.priceMin, priceBounds.min),
    max: numberOr(state.priceMax, priceBounds.max),
  };

  const hue: NumericRange = {
    min: numberOr(state.hueMin, 0),
    max: numberOr(state.hueMax, 60),
  };

  const saturation: NumericRange = {
    min: numberOr(state.saturationMin, SATURATION_BOUNDS.min),
    max: numberOr(state.saturationMax, SATURATION_BOUNDS.max),
  };

  const lightness: NumericRange = {
    min: numberOr(state.lightnessMin, LIGHTNESS_BOUNDS.min),
    max: numberOr(state.lightnessMax, LIGHTNESS_BOUNDS.max),
  };


  const ratingCounts = new Map(
    facets.ratings.map((bucket) => [Number(bucket.value), bucket.count]),
  );

  const money = (cents: number): string =>
    isCents(cents) ? formatPrice(cents) : "—";

  /**
   * The saturation and lightness ramps are painted in the hue being selected,
   * so the controls preview what they are about to filter. Mid-drag the URL is
   * still a gesture behind, so the ring reports its live value here and that
   * wins while it exists.
   */
  const rampHue = hueActive
    ? Option.match<number, number>({
        onSome: (live) => live,
        onNone: () => hue.min,
      })(huePreview)
    : DEFAULT_RAMP_HUE;

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between pb-1">
        <h2 className="font-semibold text-ink">Filters</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-xs font-medium text-accent hover:underline"
        >
          Clear all
        </button>
      </div>

      {/*
        Category first, because it decides what the rest of the rail even is.
        The three below it are exclusive: a product is one of these things, not
        a combination of them. Choosing one takes the filters of the others off
        the rail and out of the URL together.
      */}
      <Section
        title="Category"
        summary={facets.categories.find((bucket) => bucket.value === state.category)?.label ?? ""}
      >
        <RadioList
          name="category"
          lockEmpty={false}
          buckets={facets.categories}
          selected={state.category}
          onSelect={(value) => onChange({ category: value })}
        />
      </Section>

      {/*
        Colors. The three controls read as one instrument when they sit
        together, which is why they lead the color-specific half.
      */}
      {match(controls.colors)
        .with(false, () => null)
        .with(true, () => (
          <>
            {/*
              Hue, saturation and lightness are one coordinate in three parts — a
              shopper narrowing a color moves all three or none — so they open and
              close together rather than as three sections to scroll past.
            */}
            <Section
              title="HSL"
              summary={settledCount([
                hueActive,
                hasRange(state.saturationMin, state.saturationMax),
                hasRange(state.lightnessMin, state.lightnessMax),
              ])}
            >
              <div className="space-y-4">
                <div className="space-y-3">
                  <HueRing
                    value={hue}
                    active={hueActive}
                    onChange={(next) =>
                      onChange({ hueMin: String(next.min), hueMax: String(next.max) })
                    }
                    onActivate={(next) =>
                      onChange({ hueMin: String(next.min), hueMax: String(next.max) })
                    }
                    onPreview={(next) => setHuePreview(Option.some(next.min))}
                  />

                  {match(hueActive)
                    .with(true, () => (
                      <button
                        type="button"
                        onClick={() => {
                          setHuePreview(Option.none);
                          onChange({ hueMin: "", hueMax: "" });
                        }}
                        className="w-full rounded-lg border border-line py-1.5 text-xs font-medium text-ink-soft hover:bg-sunken hover:text-ink"
                      >
                        Any hue
                      </button>
                    ))
                    .with(false, () => null)
                    .exhaustive()}
                </div>

                <RangeSlider
                  label="Saturation"
                  min={SATURATION_BOUNDS.min}
                  max={SATURATION_BOUNDS.max}
                  value={saturation}
                  format={(value) => `${value}%`}
                  trackBackground={`linear-gradient(to right, hsl(${rampHue} 0% 55%), hsl(${rampHue} 100% 55%))`}
                  onChange={(next) =>
                    onChange({
                      saturationMin:
                        next.min <= SATURATION_BOUNDS.min ? "" : String(next.min),
                      saturationMax:
                        next.max >= SATURATION_BOUNDS.max ? "" : String(next.max),
                    })
                  }
                />

                <RangeSlider
                  label="Lightness"
                  min={LIGHTNESS_BOUNDS.min}
                  max={LIGHTNESS_BOUNDS.max}
                  value={lightness}
                  format={(value) => `${value}%`}
                  trackBackground={`linear-gradient(to right, hsl(${rampHue} 55% 0%), hsl(${rampHue} 55% 50%), hsl(${rampHue} 55% 100%))`}
                  onChange={(next) =>
                    onChange({
                      lightnessMin:
                        next.min <= LIGHTNESS_BOUNDS.min ? "" : String(next.min),
                      lightnessMax:
                        next.max >= LIGHTNESS_BOUNDS.max ? "" : String(next.max),
                    })
                  }
                />
              </div>
            </Section>
          </>
        ))
        .exhaustive()}

      {/*
        The finish, which colors and finishers are both narrowed by.

        A color's finish is three amounts and therefore three questions, all of
        them live at once: a color carries all three, so a shopper can ask for
        a lacquered surface that is also iridescent and also glowing, which is
        a thing real paint is. Each is asked on its own axis, because they are
        measured in different things: a roughness is a percentage, a coating is
        a thickness in nanometers, and a glow is how hard the pigment gives
        light back.

        A finisher is not a surface with three amounts on it; it is bought for
        the one effect it produces, and for how much of that effect it has. So
        it is two questions: which of the three words, and then where on the
        amount each ticked word names. Each word names a different amount,
        which is why a word's slider appears only once it is ticked.
      */}
      {match(controls.finishers || controls.amounts.length > 0)
        .with(false, () => null)
        .with(true, () => (
          <Section
            title="Finish"
            summary={settledCount([...state.finish.map(() => true), ...amountsNarrowed])}
          >
            <div className="space-y-4">
              {match(controls.finishers)
                .with(false, () => null)
                .with(true, () => (
                  <CheckList
                    name="finish"
                    buckets={facets.finishes}
                    selected={state.finish}
                    onToggle={(value) => onChange({ finish: toggle(state.finish, value) })}
                  />
                ))
                .exhaustive()}

              {controls.amounts.map((band) => (
                <AmountSlider
                  key={band.property}
                  band={band}
                  state={state}
                  onChange={onChange}
                />
              ))}
            </div>
          </Section>
        ))
        .exhaustive()}

      {/* Shifters: how far it turns a color, and which way round. */}
      {match(controls.shifters)
        .with(false, () => null)
        .with(true, () => (
          <>
            <Section
              title="Arc"
              summary={
                state.arcMin === "" && state.arcMax === ""
                  ? ""
                  : `${arc.min}°–${arc.max}°`
              }
            >
              <RangeSlider
                label="Arc"
                min={ARC_BOUNDS.min}
                max={ARC_BOUNDS.max}
                step={5}
                value={arc}
                format={(value) => `${value}°`}
                // Deliberately not the hue wheel: an arc is how far a shifter
                // turns, not where on the wheel it lands. The ramp reads as
                // "a nudge" on the left and "all the way round" on the right.
                trackBackground="linear-gradient(to right, var(--color-sunken), var(--color-accent))"
                onChange={(next) =>
                  onChange({
                    arcMin: next.min <= ARC_BOUNDS.min ? "" : String(next.min),
                    arcMax: next.max >= ARC_BOUNDS.max ? "" : String(next.max),
                  })
                }
              />
            </Section>

            <Section
              title="Direction"
              summary={Option.match<ShiftDirection, string>({
                onSome: (chosen) => (chosen === "cw" ? "CW" : "CCW"),
                onNone: () => "",
              })(direction)}
            >
              <DirectionToggle
                value={direction}
                onChange={(next) =>
                  onChange({
                    direction: Option.match<ShiftDirection, string>({
                      onSome: (chosen) => chosen,
                      onNone: () => "",
                    })(next),
                  })
                }
              />
            </Section>
          </>
        ))
        .exhaustive()}

      <Section
        title="Foundry"
        summary={state.brands.length > 0 ? `${state.brands.length} chosen` : ""}
      >
        <CheckList
          name="brand"
          buckets={facets.brands}
          selected={state.brands}
          onToggle={(value) => onChange({ brands: toggle(state.brands, value) })}
        />
      </Section>

      <Section
        title="Rating"
        summary={state.minRating === "" ? "" : `${state.minRating}★ & up`}
      >
        <StarRating
          value={numberOr(state.minRating, 0)}
          counts={ratingCounts}
          onChange={(next) =>
            onChange({ minRating: next === 0 ? "" : String(next) })
          }
        />
      </Section>

      <Section
        title="Price"
        summary={
          state.priceMin === "" && state.priceMax === ""
            ? ""
            : `${money(price.min)}+`
        }
      >
        <RangeSlider
          label="Price"
          min={priceBounds.min}
          max={priceBounds.max}
          step={50}
          value={price}
          format={money}
          onChange={(next) =>
            onChange({
              // Dragging back to the ends means "no filter", not "filter to
              // the full range" — the URL stays clean and shareable.
              priceMin: next.min <= priceBounds.min ? "" : String(next.min),
              priceMax: next.max >= priceBounds.max ? "" : String(next.max),
            })
          }
        />
      </Section>
    </div>
  );
};
