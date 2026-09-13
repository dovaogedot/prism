import type { FacetBucket } from "@prism/shared";
import { match } from "ts-pattern";
import { CatalogParams } from "../filters.ts";

/** The categories with their counts, the filters as the URL has them, and where a choice goes. */
export type CategoryCardsProps = Readonly<{
  buckets: readonly FacetBucket[];
  params: URLSearchParams;
  onChange: (next: URLSearchParams) => void;
}>;

/**
 * One card per category, counting everything filed under it. Choosing one
 * drops every other filter; choosing the chosen one clears the choice.
 */
export const CategoryCards = ({ buckets, params, onChange }: CategoryCardsProps) => (
  <nav aria-label="Categories" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
    {buckets.map((bucket) => {
      const chosen = params.get("category") === bucket.value;
      const tone = match(chosen)
        .with(true, () => "border-accent bg-accent-wash text-ink")
        .with(false, () => "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink")
        .exhaustive();

      return (
        <button
          key={bucket.value}
          type="button"
          aria-pressed={chosen}
          onClick={() => onChange(CatalogParams.set(CatalogParams.cleared(params), "category", chosen ? "" : bucket.value))}
          className={`rounded-lg border px-3 py-3 text-left transition-colors ${tone}`}
        >
          <span className="block truncate text-sm font-semibold">{bucket.label}</span>
          <span className="block text-xs tabular-nums text-ink-faint">
            {bucket.count} item{bucket.count === 1 ? "" : "s"}
          </span>
        </button>
      );
    })}
  </nav>
);
