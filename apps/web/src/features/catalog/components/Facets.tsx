/**
 * The filter rail, drawn from the facets the server counted for the current
 * results. Nothing here knows what the shop sells: the property groups are
 * whatever names the matching products carry.
 */

import type { FacetBucket, ProductFacets } from "@prism/shared";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import { CatalogParams } from "../filters.ts";

/** The facets, the filters as the URL has them, and where a change goes. */
export type FacetsProps = Readonly<{
  facets: ProductFacets;
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}>;

const Group = ({ title, children }: Readonly<{ title: string; children: ReactNode }>) => (
  <fieldset className="space-y-1.5">
    <legend className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</legend>
    {children}
  </fieldset>
);

const Option = ({
  bucket,
  type,
  checked,
  onChange,
}: Readonly<{ bucket: FacetBucket; type: "checkbox" | "radio"; checked: boolean; onChange: () => void }>) => (
  <label className="flex items-center gap-2 text-sm text-ink-soft hover:text-ink">
    <input type={type} checked={checked} onChange={onChange} disabled={bucket.count === 0 && !checked} />
    <span className="flex-1 truncate">{bucket.label}</span>
    <span className="text-xs tabular-nums text-ink-faint">{bucket.count}</span>
  </label>
);

/** A checkbox group over a repeatable key. */
const Checklist = ({
  title,
  keyName,
  buckets,
  params,
  onChange,
}: Readonly<{ title: string; keyName: string; buckets: readonly FacetBucket[]; params: URLSearchParams; onChange: (next: URLSearchParams) => void }>) =>
  match(buckets.length)
    .with(0, () => null)
    .otherwise(() => (
      <Group title={title}>
        {buckets.map((bucket) => (
          <Option
            key={bucket.value}
            bucket={bucket}
            type="checkbox"
            checked={CatalogParams.has(params, keyName, bucket.value)}
            onChange={() => onChange(CatalogParams.toggle(params, keyName, bucket.value))}
          />
        ))}
      </Group>
    ));

/** A radio group over a single-valued key, where choosing the chosen value clears it. */
const Choice = ({
  title,
  keyName,
  buckets,
  params,
  onChange,
}: Readonly<{ title: string; keyName: string; buckets: readonly FacetBucket[]; params: URLSearchParams; onChange: (next: URLSearchParams) => void }>) =>
  match(buckets.length)
    .with(0, () => null)
    .otherwise(() => (
      <Group title={title}>
        {buckets.map((bucket) => {
          const chosen = params.get(keyName) === bucket.value;

          return (
            <Option
              key={bucket.value}
              bucket={bucket}
              type="radio"
              checked={chosen}
              onChange={() => onChange(CatalogParams.set(params, keyName, chosen ? "" : bucket.value))}
            />
          );
        })}
      </Group>
    ));

/** Two bounds in whole currency units, applied together. */
const PriceRange = ({ facets, params, onChange }: FacetsProps) => (
  <Group title="Price">
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const cents = (name: string): string => {
          const raw = data.get(name);
          return typeof raw === "string" && raw.length > 0 ? String(Math.round(Number(raw) * 100)) : "";
        };

        onChange(CatalogParams.set(CatalogParams.set(params, "priceMin", cents("min")), "priceMax", cents("max")));
      }}
    >
      <input
        type="number"
        name="min"
        min={0}
        step="0.01"
        aria-label="Lowest price"
        placeholder={(facets.price.minCents / 100).toFixed(2)}
        defaultValue={params.get("priceMin") === null ? "" : Number(params.get("priceMin")) / 100}
        className="w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
      />
      <span className="text-ink-faint">–</span>
      <input
        type="number"
        name="max"
        min={0}
        step="0.01"
        aria-label="Highest price"
        placeholder={(facets.price.maxCents / 100).toFixed(2)}
        defaultValue={params.get("priceMax") === null ? "" : Number(params.get("priceMax")) / 100}
        className="w-full min-w-0 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
      />
      <button type="submit" className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-soft hover:bg-sunken">
        Go
      </button>
    </form>
  </Group>
);

/** Every filter the current results can be narrowed by. */
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

    <Choice title="Category" keyName="category" buckets={facets.categories} params={params} onChange={onChange} />
    <Checklist title="Brand" keyName="brand" buckets={facets.brands} params={params} onChange={onChange} />
    <PriceRange facets={facets} params={params} onChange={onChange} />
    <Choice title="Rating" keyName="rating" buckets={facets.ratings} params={params} onChange={onChange} />

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
  </div>
);
