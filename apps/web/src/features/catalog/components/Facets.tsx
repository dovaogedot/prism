/**
 * The filter rail, drawn from the facets the server counted for the current
 * results. Nothing here knows what the shop sells: the property groups are
 * whatever names the matching products carry.
 */

import { Price, type FacetBucket, type ProductFacets } from "@prism/shared";
import { useState, type ReactNode } from "react";
import { match } from "ts-pattern";
import { CatalogParams } from "../filters.ts";
import { RangeSlider } from "./RangeSlider.tsx";

/** The facets, the filters as the URL has them, and where a change goes. */
export type FacetsProps = Readonly<{
  facets: ProductFacets;
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}>;

/** How many values a group shows before the rest fold behind "Show more". */
const FOLD_AT = 8;

/** A group's frame: its heading, "Clear all" beside it while the group has a choice, and its rows. */
const Group = ({ title, chosen, onClear, children }: Readonly<{ title: string; chosen: boolean; onClear: () => void; children: ReactNode }>) => (
  // min-w-0: a fieldset is otherwise never narrower than its longest row, and would overflow the rail.
  <fieldset className="min-w-0 space-y-1.5">
    <legend className="mb-1.5 flex w-full items-center justify-between text-xs">
      <span className="font-semibold uppercase tracking-wider text-ink-faint">{title}</span>
      {match(chosen)
        .with(true, () => (
          <button type="button" onClick={onClear} className="font-medium text-accent hover:underline">
            Clear all
          </button>
        ))
        .with(false, () => null)
        .exhaustive()}
    </legend>
    {children}
  </fieldset>
);

/** A value's row, greyed rather than removed when the other filters leave it nothing. */
const Row = {
  classes: (empty: boolean): string =>
    empty
      ? "flex items-center gap-2 text-sm text-ink-faint opacity-50"
      : "flex items-center gap-2 text-sm text-ink-soft hover:text-ink",
} as const;

const Count = ({ count }: Readonly<{ count: number }>) => (
  <span className="text-xs tabular-nums text-ink-faint">{count}</span>
);

/**
 * A checkbox group over a repeatable key. Past `FOLD_AT` values the rest
 * fold away, except any that are ticked, which stay in view.
 */
const Checklist = ({
  title,
  keyName,
  buckets,
  params,
  onChange,
}: Readonly<{ title: string; keyName: string; buckets: readonly FacetBucket[]; params: URLSearchParams; onChange: (next: URLSearchParams) => void }>) => {
  const [expanded, setExpanded] = useState(false);
  const ticked = (bucket: FacetBucket): boolean => CatalogParams.has(params, keyName, bucket.value);
  const visible = expanded ? buckets : buckets.filter((bucket, index) => index < FOLD_AT || ticked(bucket));

  return match(buckets.length)
    .with(0, () => null)
    .otherwise(() => (
      <Group title={title} chosen={params.has(keyName)} onClear={() => onChange(CatalogParams.set(params, keyName, ""))}>
        {visible.map((bucket) => (
          <label key={bucket.value} className={Row.classes(bucket.count === 0 && !ticked(bucket))}>
            <input
              type="checkbox"
              checked={ticked(bucket)}
              onChange={() => onChange(CatalogParams.toggle(params, keyName, bucket.value))}
              disabled={bucket.count === 0 && !ticked(bucket)}
            />
            <span className="flex-1 truncate">{bucket.label}</span>
            <Count count={bucket.count} />
          </label>
        ))}

        {match(buckets.length > FOLD_AT)
          .with(true, () => (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
              className="text-xs font-medium text-accent hover:underline"
            >
              {expanded ? "Show less" : `Show ${buckets.length - visible.length} more`}
            </button>
          ))
          .with(false, () => null)
          .exhaustive()}
      </Group>
    ));
};

/** Five stars, the first `filled` of them lit. */
const StarRow = ({ filled }: Readonly<{ filled: number }>) => (
  <span aria-hidden="true" className="inline-flex">
    {[0, 1, 2, 3, 4].map((index) => (
      <svg key={index} viewBox="0 0 20 20" className="size-4">
        <path
          fill={index < filled ? "var(--color-accent)" : "var(--color-line-strong)"}
          d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z"
        />
      </svg>
    ))}
  </span>
);

/** The minimum rating as rows of stars; choosing the chosen row clears it. */
const RatingFacet = ({ facets, params, onChange }: FacetsProps) =>
  match(facets.ratings.length)
    .with(0, () => null)
    .otherwise(() => (
      <Group title="Rating" chosen={params.has("rating")} onClear={() => onChange(CatalogParams.set(params, "rating", ""))}>
        {facets.ratings.map((bucket) => {
          const chosen = params.get("rating") === bucket.value;
          const threshold = Number(bucket.value);

          return (
            <label key={bucket.value} className={Row.classes(bucket.count === 0 && !chosen)}>
              <input
                type="radio"
                name="rating"
                checked={chosen}
                onClick={() => onChange(CatalogParams.set(params, "rating", chosen ? "" : bucket.value))}
                onChange={() => undefined}
                disabled={bucket.count === 0 && !chosen}
                aria-label={bucket.label}
              />
              <StarRow filled={threshold} />
              <span className="flex-1 text-xs">{threshold < 5 ? "& up" : ""}</span>
              <Count count={bucket.count} />
            </label>
          );
        })}
      </Group>
    ));

/** Two thumbs between the cheapest and dearest matching product. */
const PriceFacet = ({ facets, params, onChange }: FacetsProps) => {
  const { minCents, maxCents } = facets.price;
  const value = {
    min: Number(params.get("priceMin") ?? minCents),
    max: Number(params.get("priceMax") ?? maxCents),
  };

  return match(maxCents > minCents)
    .with(false, () => null)
    .with(true, () => (
      <Group
        title="Price"
        chosen={params.has("priceMin") || params.has("priceMax")}
        onClear={() => onChange(CatalogParams.set(CatalogParams.set(params, "priceMin", ""), "priceMax", ""))}
      >
        <RangeSlider
          label="Price"
          min={minCents}
          max={maxCents}
          value={value}
          format={Price.format}
          onChange={(next) =>
            // A thumb at the end of the track is no filter at all.
            onChange(
              CatalogParams.set(
                CatalogParams.set(params, "priceMin", next.min <= minCents ? "" : String(next.min)),
                "priceMax",
                next.max >= maxCents ? "" : String(next.max),
              ),
            )
          }
        />
      </Group>
    ))
    .exhaustive();
};

/** Every filter the shelf can be narrowed by, apart from the category; the price and rating last. */
export const Facets = ({ facets, params, onChange }: FacetsProps) => (
  <div className="space-y-6">
    {match(CatalogParams.isFiltered(params))
      .with(true, () => (
        <button
          type="button"
          onClick={() => onChange(CatalogParams.cleared(params))}
          className="text-sm font-medium text-accent hover:underline"
        >
          Clear all filters
        </button>
      ))
      .with(false, () => null)
      .exhaustive()}

    <Checklist title="Brand" keyName="brand" buckets={facets.brands} params={params} onChange={onChange} />

    {facets.properties.map((property) => (
      <Checklist
        key={property.name}
        title={property.name}
        keyName={CatalogParams.propertyKey(property.name)}
        buckets={property.buckets}
        params={params}
        onChange={onChange}
      />
    ))}

    <PriceFacet facets={facets} params={params} onChange={onChange} />
    <RatingFacet facets={facets} params={params} onChange={onChange} />
  </div>
);
