/**
 * The filter rail.
 *
 * Counts come from the server computed per dimension, so ticking a second
 * brand widens the result instead of emptying it. The hue slider is the one
 * filter that only makes sense in a shop like this.
 */

import { formatPrice, isCents, type FacetBucket, type ProductFacets } from "@hue/shared";
import type { ReactNode } from "react";
import { match } from "ts-pattern";

export type FacetState = Readonly<{
  category: string;
  brands: readonly string[];
  finishes: readonly string[];
  minRating: string;
  hueMin: string;
  hueMax: string;
}>;

export type FacetsProps = Readonly<{
  facets: ProductFacets;
  state: FacetState;
  onChange: (next: Partial<FacetState>) => void;
  onReset: () => void;
}>;

const Section = ({
  title,
  children,
}: Readonly<{ title: string; children: ReactNode }>) => (
  <section className="border-b border-line py-4 first:pt-0 last:border-0">
    <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">
      {title}
    </h3>
    {children}
  </section>
);

const toggle = (values: readonly string[], value: string): readonly string[] =>
  values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];

const CheckList = ({
  buckets,
  selected,
  onToggle,
}: Readonly<{
  buckets: readonly FacetBucket[];
  selected: readonly string[];
  onToggle: (value: string) => void;
}>) =>
  match(buckets.length)
    .with(0, () => <p className="text-sm text-ink-faint">Nothing to filter by.</p>)
    .otherwise(() => (
      <ul className="space-y-1">
        {buckets.map((bucket) => (
          <li key={bucket.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 text-sm hover:bg-sunken">
              <input
                type="checkbox"
                checked={selected.includes(bucket.value)}
                onChange={() => onToggle(bucket.value)}
                className="size-4 shrink-0 accent-[--color-accent]"
              />
              <span className="flex-1 truncate text-ink">{bucket.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {bucket.count}
              </span>
            </label>
          </li>
        ))}
      </ul>
    ));

export const Facets = ({ facets, state, onChange, onReset }: FacetsProps) => (
  <div className="text-sm">
    <div className="flex items-center justify-between pb-3">
      <h2 className="font-semibold text-ink">Filters</h2>
      <button
        type="button"
        onClick={onReset}
        className="text-xs font-medium text-accent hover:underline"
      >
        Clear all
      </button>
    </div>

    <Section title="Category">
      <ul className="space-y-1">
        <li>
          <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-sunken">
            <input
              type="radio"
              name="category"
              checked={state.category === ""}
              onChange={() => onChange({ category: "" })}
              className="size-4 accent-[--color-accent]"
            />
            <span className="text-ink">Everything</span>
          </label>
        </li>
        {facets.categories.map((bucket) => (
          <li key={bucket.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-sunken">
              <input
                type="radio"
                name="category"
                checked={state.category === bucket.value}
                onChange={() => onChange({ category: bucket.value })}
                className="size-4 shrink-0 accent-[--color-accent]"
              />
              <span className="flex-1 truncate text-ink">{bucket.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {bucket.count}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Section>

    <Section title="Foundry">
      <CheckList
        buckets={facets.brands}
        selected={state.brands}
        onToggle={(value) => onChange({ brands: toggle(state.brands, value) })}
      />
    </Section>

    <Section title="Finish">
      <CheckList
        buckets={facets.finishes}
        selected={state.finishes}
        onToggle={(value) => onChange({ finishes: toggle(state.finishes, value) })}
      />
    </Section>

    <Section title="Rating">
      <ul className="space-y-1">
        {facets.ratings.map((bucket) => (
          <li key={bucket.value}>
            <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-sunken">
              <input
                type="radio"
                name="rating"
                checked={state.minRating === bucket.value}
                onChange={() => onChange({ minRating: bucket.value })}
                className="size-4 shrink-0 accent-[--color-accent]"
              />
              <span className="flex-1 text-ink">{bucket.label}</span>
              <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                {bucket.count}
              </span>
            </label>
          </li>
        ))}
        <li>
          <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1 hover:bg-sunken">
            <input
              type="radio"
              name="rating"
              checked={state.minRating === ""}
              onChange={() => onChange({ minRating: "" })}
              className="size-4 accent-[--color-accent]"
            />
            <span className="text-ink">Any rating</span>
          </label>
        </li>
      </ul>
    </Section>

    <Section title="Hue">
      <div className="space-y-3">
        {/* The whole circle, so the slider reads as a position on it. */}
        <div
          className="h-3 rounded-full border border-line"
          style={{
            backgroundImage:
              "linear-gradient(to right, hsl(0 85% 55%), hsl(60 85% 55%), hsl(120 85% 55%), hsl(180 85% 55%), hsl(240 85% 55%), hsl(300 85% 55%), hsl(360 85% 55%))",
          }}
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-xs text-ink-faint">From {state.hueMin || 0}°</span>
            <input
              type="range"
              min={0}
              max={360}
              value={state.hueMin === "" ? 0 : Number(state.hueMin)}
              onChange={(event) => onChange({ hueMin: event.target.value })}
              className="w-full accent-[--color-accent]"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-ink-faint">To {state.hueMax || 360}°</span>
            <input
              type="range"
              min={0}
              max={360}
              value={state.hueMax === "" ? 360 : Number(state.hueMax)}
              onChange={(event) => onChange({ hueMax: event.target.value })}
              className="w-full accent-[--color-accent]"
            />
          </label>
        </div>

        {/* Reds live either side of 0°, so the wrap is a feature worth naming. */}
        {match(Number(state.hueMin) > Number(state.hueMax))
          .with(true, () => (
            <p className="text-xs text-ink-faint">
              Wrapping through 0° — this is the arc where the reds live.
            </p>
          ))
          .with(false, () => null)
          .exhaustive()}
      </div>
    </Section>

    <Section title="Price">
      <p className="text-sm text-ink-soft">
        {match(isCents(facets.priceCents.min) && isCents(facets.priceCents.max))
          .with(true, () =>
            isCents(facets.priceCents.min) && isCents(facets.priceCents.max)
              ? `${formatPrice(facets.priceCents.min)} – ${formatPrice(facets.priceCents.max)}`
              : "—",
          )
          .with(false, () => "—")
          .exhaustive()}
      </p>
    </Section>
  </div>
);
