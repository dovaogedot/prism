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
  formatPrice,
  isCents,
  LIGHTNESS_BOUNDS,
  Option,
  SATURATION_BOUNDS,
  type FacetBucket,
  type NumericRange,
  type ProductFacets,
} from "@prism/shared";
import { useState, type ReactNode } from "react";
import { match, P } from "ts-pattern";
import { HueRing } from "./HueRing.tsx";
import { RangeSlider } from "./RangeSlider.tsx";

export type FacetState = Readonly<{
  category: string;
  brands: readonly string[];
  finishes: readonly string[];
  minRating: string;
  priceMin: string;
  priceMax: string;
  hueMin: string;
  hueMax: string;
  saturationMin: string;
  saturationMax: string;
  lightnessMin: string;
  lightnessMax: string;
}>;

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
            return `${threshold}★ & up — ${total} color${total === 1 ? "" : "s"}`;
          })}
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------- rail */

const numberOr = (raw: string, fallback: number): number =>
  raw === "" ? fallback : Number(raw);

/** The ring is shown in a neutral blue while no hue is selected. */
const DEFAULT_RAMP_HUE = 220;

export const Facets = ({ facets, state, onChange, onReset }: FacetsProps) => {
  const priceBounds = facets.priceCents;
  const hueActive = state.hueMin !== "" || state.hueMax !== "";

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
        Color first. It is the only filter that is specific to this shop, it is
        the one a shopper reaches for, and the three controls read as one
        instrument when they sit together.
      */}
      <Section title="Hue" summary={hueActive ? `${hue.min}°–${hue.max}°` : ""}>
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
      </Section>

      <Section
        title="Saturation"
        summary={
          state.saturationMin === "" && state.saturationMax === ""
            ? ""
            : `${saturation.min}–${saturation.max}%`
        }
      >
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
      </Section>

      <Section
        title="Lightness"
        summary={
          state.lightnessMin === "" && state.lightnessMax === ""
            ? ""
            : `${lightness.min}–${lightness.max}%`
        }
      >
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
      </Section>

      <Section
        title="Finish"
        summary={state.finishes.length > 0 ? `${state.finishes.length} chosen` : ""}
      >
        <CheckList
          name="finish"
          buckets={facets.finishes}
          selected={state.finishes}
          onToggle={(value) => onChange({ finishes: toggle(state.finishes, value) })}
        />
      </Section>

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
