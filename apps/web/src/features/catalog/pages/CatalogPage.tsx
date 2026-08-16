/**
 * The shop.
 *
 * Filter state lives in the URL, not in component state, so every view is
 * shareable and the back button behaves. `keepPreviousData` holds the old grid
 * on screen while a new filter loads, which is what stops the page collapsing
 * to a spinner every time a checkbox moves.
 */

import {
  PRODUCT_SORTS,
  resolveSearchTerm,
  tagChain,
  type ProductSearchResult,
  type ProductSort,
} from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { api, toQueryString } from "../../../shared/api/client.ts";
import { Facets, type FacetState } from "../components/Facets.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { SearchBox } from "../components/SearchBox.tsx";
import { Alert, Button, Skeleton } from "../../../shared/ui/index.ts";

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

export const CatalogPage = () => {
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
    priceMin: params.get("priceMin") ?? "",
    priceMax: params.get("priceMax") ?? "",
    hueMin: params.get("hueMin") ?? "",
    hueMax: params.get("hueMax") ?? "",
    saturationMin: params.get("saturationMin") ?? "",
    saturationMax: params.get("saturationMax") ?? "",
    lightnessMin: params.get("lightnessMin") ?? "",
    lightnessMax: params.get("lightnessMax") ?? "",
  };

  const query = toQueryString({
    q: term,
    ...facetState,
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

        // An empty value means "no filter" and leaves the URL. `0` is only
        // meaningless for `page`; for a hue or lightness bound it is a real
        // setting, so it has to survive.
        const meaningless =
          encoded.length === 0 || (key === "page" && encoded === "0");

        if (meaningless) updated.delete(key);
        else updated.set(key, encoded);
      }

      if (!("page" in next)) updated.delete("page");

      return updated;
    });
  };

  /**
   * A term that names a facet becomes that filter rather than a text query.
   * Typing "gloss" means gloss colors, not colors whose prose mentions gloss;
   * typing "golds" means the gold tag, which is stored singular.
   *
   * The vocabulary comes from the facets already on screen, so it needs no
   * request of its own.
   */
  const submitSearch = (raw: string): void => {
    const tags = (results.data?.facets.categories ?? []).map((bucket) => bucket.value);

    match(resolveSearchTerm(raw, tags))
      .with({ kind: "finish" }, ({ finish }) =>
        update({
          q: "",
          finishes: facetState.finishes.includes(finish)
            ? facetState.finishes
            : [...facetState.finishes, finish],
        }),
      )
      .with({ kind: "tag" }, ({ slug }) => update({ q: "", category: slug }))
      .with({ kind: "text" }, ({ text }) => update({ q: text }))
      .exhaustive();
  };

  /**
   * Paging keeps the scroll position by default, which lands you at the bottom
   * of a grid you have not seen the top of yet. Jump instantly rather than
   * smoothly: the content underneath has already been replaced, so animating
   * past it is scenery from the previous page.
   */
  const goToPage = (next: number): void => {
    update({ page: next });
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 space-y-5">
        <div className="max-w-2xl space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Every color, on its own terms
          </h1>
          <p className="text-ink-soft">
            Sealed at source, sold by the hue. Filter by foundry, finish, or the
            arc of the color wheel you happen to be after.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={term} onSubmit={submitSearch} />

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
        <aside>
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

        {/*
          A floor under the results, so narrowing 240 colors down to 3 does
          not collapse the document height and yank the scroll position with it.
        */}
        <section
          aria-label="Colors"
          aria-busy={results.isFetching}
          className="min-h-[70dvh]"
        >
          {match(results)
            .with({ status: "error" }, () => (
              <Alert title="We could not load the catalog">
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
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-ink-faint">
                        {data.total} color{data.total === 1 ? "" : "s"}
                        {data.totalPages > 1
                          ? ` · page ${data.page} of ${data.totalPages}`
                          : ""}
                      </p>

                      {/*
                        The tag is the one active filter the rail cannot show,
                        so it is shown here — and removable, or a tag arrived at
                        from a card would be a one-way door.
                      */}
                      {match(tagChain(data.facets.categories, facetState.category))
                        .with([], () => null)
                        .otherwise((chain) => (
                          <button
                            type="button"
                            onClick={() => update({ category: "" })}
                            className="flex items-center gap-1 rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-medium text-ink hover:bg-sunken"
                          >
                            {chain.map((tag) => tag.label).join(" › ")}
                            <span aria-hidden="true">✕</span>
                            <span className="sr-only">Clear this tag</span>
                          </button>
                        ))}
                    </div>

                    <div
                      className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 xl:grid-cols-4 ${
                        results.isFetching ? "opacity-60" : "opacity-100"
                      }`}
                    >
                      {data.items.map((product) => (
                        <ProductCard
                          key={product.id}
                          product={product}
                          tags={tagChain(data.facets.categories, product.category.slug)}
                          onSelectTag={(slug) => update({ category: slug })}
                        />
                      ))}
                    </div>

                    {match(data.totalPages > 1)
                      .with(true, () => (
                        <nav
                          aria-label="Pagination"
                          className="mt-5 flex items-center justify-center gap-3"
                        >
                          <Button
                            tone="quiet"
                            disabled={data.page <= 1}
                            onClick={() => goToPage(data.page - 1)}
                          >
                            Previous
                          </Button>
                          <span className="text-sm tabular-nums text-ink-soft">
                            {data.page} / {data.totalPages}
                          </span>
                          <Button
                            tone="quiet"
                            disabled={data.page >= data.totalPages}
                            onClick={() => goToPage(data.page + 1)}
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
