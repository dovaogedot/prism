/**
 * The shop.
 *
 * Filter state lives in the URL, not in component state, so every view is
 * shareable and the back button behaves. `keepPreviousData` holds the old grid
 * on screen while a new filter loads, which is what stops the page collapsing
 * to a spinner every time a checkbox moves.
 */

import { PRODUCT_SORTS, type ProductSearchResult, type ProductSort } from "@hue/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { api, toQueryString } from "../lib/api.ts";
import { Facets, type FacetState } from "../components/Facets.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { SearchBox } from "../components/SearchBox.tsx";
import { Alert, Button, Skeleton } from "../components/primitives.tsx";

const SORT_LABELS: Record<ProductSort, string> = {
  relevance: "Relevance",
  price_asc: "Price: low to high",
  price_desc: "Price: high to low",
  rating: "Best rated",
};

const isSort = (value: string): value is ProductSort =>
  PRODUCT_SORTS.some((sort) => sort === value);

const splitList = (value: string): readonly string[] =>
  value.split(",").filter((entry) => entry.length > 0);

export const CataloguePage = () => {
  const [params, setParams] = useSearchParams();

  const term = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1");
  const sortParam = params.get("sort") ?? "relevance";
  const sort: ProductSort = isSort(sortParam) ? sortParam : "relevance";

  const facetState: FacetState = {
    category: params.get("category") ?? "",
    brands: splitList(params.get("brands") ?? ""),
    finishes: splitList(params.get("finishes") ?? ""),
    minRating: params.get("minRating") ?? "",
    hueMin: params.get("hueMin") ?? "",
    hueMax: params.get("hueMax") ?? "",
  };

  const query = toQueryString({
    q: term,
    category: facetState.category,
    brands: facetState.brands,
    finishes: facetState.finishes,
    minRating: facetState.minRating,
    hueMin: facetState.hueMin,
    hueMax: facetState.hueMax,
    sort,
    page,
  });

  const results = useQuery({
    queryKey: ["products", query],
    queryFn: ({ signal }) =>
      api.get<ProductSearchResult>(`/products${query}`, signal),
    // Without this the whole grid unmounts on every filter change.
    placeholderData: keepPreviousData,
  });

  /** Any filter change resets to page 1 — page 4 of a new filter is nowhere. */
  const update = (next: Partial<FacetState & { q: string; sort: string; page: number }>): void => {
    setParams((current) => {
      const updated = new URLSearchParams(current);

      for (const [key, value] of Object.entries(next)) {
        const encoded = Array.isArray(value) ? value.join(",") : String(value);
        if (encoded.length === 0 || encoded === "0") updated.delete(key);
        else updated.set(key, encoded);
      }

      if (!("page" in next)) updated.delete("page");

      return updated;
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 space-y-5">
        <div className="max-w-2xl space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Every colour, by the vial
          </h1>
          <p className="text-ink-soft">
            Sealed at source, sold by the hue. Filter by foundry, finish, or the
            arc of the colour wheel you happen to be after.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={term} onSubmit={(next) => update({ q: next })} />

          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Sort by</span>
            <select
              value={sort}
              onChange={(event) => update({ sort: event.target.value })}
              className="rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-ink hover:border-line-strong"
            >
              {PRODUCT_SORTS.map((option) => (
                <option key={option} value={option}>
                  {SORT_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          {match(results.data)
            .with(P.nullish, () => (
              <div className="space-y-3">
                {[0, 1, 2, 3].map((index) => (
                  <Skeleton key={index} className="h-28 w-full" />
                ))}
              </div>
            ))
            .otherwise((data) => (
              <Facets
                facets={data.facets}
                state={facetState}
                onChange={(next) => update(next)}
                onReset={() => setParams(new URLSearchParams())}
              />
            ))}
        </aside>

        <section aria-label="Colours" aria-busy={results.isFetching}>
          {match(results)
            .with({ status: "error" }, () => (
              <Alert title="We could not load the catalogue">
                Something went wrong at our end. Try again in a moment.
              </Alert>
            ))
            .with({ data: P.nullish }, () => (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton key={index} className="aspect-[3/4] w-full" />
                ))}
              </div>
            ))
            .otherwise(({ data }) =>
              match(data.items.length)
                .with(0, () => (
                  <div className="rounded-[--radius-card] border border-dashed border-line px-6 py-16 text-center">
                    <p className="font-medium text-ink">Nothing matches that.</p>
                    <p className="mt-1 text-sm text-ink-soft">
                      Try widening the hue range or clearing a filter.
                    </p>
                    <Button
                      tone="quiet"
                      className="mt-4"
                      onClick={() => setParams(new URLSearchParams())}
                    >
                      Clear all filters
                    </Button>
                  </div>
                ))
                .otherwise(() => (
                  <>
                    <p className="mb-4 text-sm text-ink-faint">
                      {data.total} colour{data.total === 1 ? "" : "s"}
                      {data.totalPages > 1
                        ? ` · page ${data.page} of ${data.totalPages}`
                        : ""}
                    </p>

                    <div
                      className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 xl:grid-cols-4 ${
                        results.isFetching ? "opacity-60" : "opacity-100"
                      }`}
                    >
                      {data.items.map((product) => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>

                    {match(data.totalPages > 1)
                      .with(true, () => (
                        <nav
                          aria-label="Pagination"
                          className="mt-8 flex items-center justify-center gap-3"
                        >
                          <Button
                            tone="quiet"
                            disabled={data.page <= 1}
                            onClick={() => update({ page: data.page - 1 })}
                          >
                            Previous
                          </Button>
                          <span className="text-sm tabular-nums text-ink-soft">
                            {data.page} / {data.totalPages}
                          </span>
                          <Button
                            tone="quiet"
                            disabled={data.page >= data.totalPages}
                            onClick={() => update({ page: data.page + 1 })}
                          >
                            Next
                          </Button>
                        </nav>
                      ))
                      .with(false, () => null)
                      .exhaustive()}
                  </>
                )),
            )}
        </section>
      </div>
    </div>
  );
};
