/**
 * The shop.
 *
 * Filter state lives in the URL, not in component state, so every view is
 * shareable and the back button behaves. `keepPreviousData` holds the old grid
 * on screen while a new filter loads, which is what stops the page collapsing
 * to a spinner every time a checkbox moves.
 */

import {
  Option,
  PRODUCT_SORTS,
  resolveSearchTerm,
  type Finish,
  type ProductSearchResult,
  type ProductSort,
} from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { api, toQueryString } from "../../../shared/api/client.ts";
import { useDrawer } from "../../../shared/layout/drawer.ts";
import { useWide } from "../../../shared/layout/use-wide.ts";
import { Facets } from "../components/Facets.tsx";
import { type FacetState, withoutHidden } from "../filters.ts";
import { ProductCard, ProductCardSlot } from "../components/ProductCard.tsx";
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

/**
 * The catalog: the search box, the filter rail, and the grid they narrow.
 *
 * The rail stands beside the grid on a wide page and is in the layout's drawer
 * on a narrow one, where a button beside the sort opens it.
 */
export const CatalogPage = () => {
  const [params, setParams] = useSearchParams();
  const wide = useWide();
  const drawer = useDrawer();

  const term = params.get("q") ?? "";
  const page = Number(params.get("page") ?? "1");
  const sortParam = params.get("sort") ?? "relevance";
  const sort: ProductSort = isSort(sortParam) ? sortParam : "relevance";

  const facetState: FacetState = {
    category: params.get("category") ?? "",
    family: params.get("family") ?? "",
    brands: splitList(params.get("brands") ?? ""),
    finish: splitList(params.get("finish") ?? ""),
    direction: params.get("direction") ?? "",
    arcMin: params.get("arcMin") ?? "",
    arcMax: params.get("arcMax") ?? "",
    minRating: params.get("minRating") ?? "",
    priceMin: params.get("priceMin") ?? "",
    priceMax: params.get("priceMax") ?? "",
    hueMin: params.get("hueMin") ?? "",
    hueMax: params.get("hueMax") ?? "",
    saturationMin: params.get("saturationMin") ?? "",
    saturationMax: params.get("saturationMax") ?? "",
    lightnessMin: params.get("lightnessMin") ?? "",
    lightnessMax: params.get("lightnessMax") ?? "",
    roughnessMin: params.get("roughnessMin") ?? "",
    roughnessMax: params.get("roughnessMax") ?? "",
    coatingMin: params.get("coatingMin") ?? "",
    coatingMax: params.get("coatingMax") ?? "",
    emissionMin: params.get("emissionMin") ?? "",
    emissionMax: params.get("emissionMax") ?? "",
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

  /**
   * Any filter change resets to page 1 — page 4 of a new filter is nowhere.
   *
   * A filter whose control the change takes off the rail leaves the URL with
   * it, so nothing narrows the shelf that the rail cannot show and clear.
   */
  const update = (next: Partial<FacetState & { q: string; sort: string; page: number }>): void => {
    const changes = { ...next, ...withoutHidden({ ...facetState, ...next }) };

    setParams((current) => {
      const updated = new URLSearchParams(current);

      for (const [key, value] of Object.entries(changes)) {
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
   * A term that names something the catalog can filter by becomes that filter
   * rather than a text query.
   *
   * Nothing is looked up: every word here resolves against what a product
   * physically is, so the answer needs no facets on screen and no request of
   * its own.
   */
  const submitSearch = (raw: string): void => {
    match(resolveSearchTerm(raw))
      .with({ kind: "category" }, ({ category }) =>
        update({ q: "", category, family: "" }),
      )
      // A finish is a thing a shopper buys, so the name of one is the shelf of
      // finishers that apply it rather than a search through the prose — and the
      // name itself is a place on one of the three amounts.
      .with({ kind: "finish" }, ({ finish }) =>
        update({ q: "", category: "finisher", finish: [finish] }),
      )
      // Only a shifter turns, so the word picks the shelf as well as the way.
      .with({ kind: "direction" }, ({ direction }) =>
        update({ q: "", category: "shifter", direction }),
      )
      // Only a color has a family, so the same is true the other way.
      .with({ kind: "family" }, ({ family }) =>
        update({ q: "", category: "color", family }),
      )
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

  const rail = match(results.data)
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
    ));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8 space-y-5">
        <div className="max-w-2xl space-y-1.5">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">
            Every color, on its own terms
          </h1>
          <p className="text-ink-soft">
            Sealed at source, sold by the hue. Plus the tools to put a finish
            back on one, and the tools to turn it into something else entirely.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchBox value={term} onSubmit={submitSearch} />

          <div className="flex gap-3">
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

            {match(wide)
              .with(true, () => null)
              .with(false, () => (
                <Button tone="quiet" type="button" aria-haspopup="dialog" onClick={drawer.open}>
                  Filters
                </Button>
              ))
              .exhaustive()}
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        {match(wide)
          .with(true, () => <aside>{rail}</aside>)
          .with(false, () =>
            Option.match<HTMLElement, ReactNode>({
              onSome: (slot) => createPortal(rail, slot),
              onNone: () => null,
            })(drawer.slot),
          )
          .exhaustive()}

        {/*
          A floor under the results, so narrowing 240 colors down to 3 does
          not collapse the document height and yank the scroll position with it.
        */}
        <section
          aria-label="Results"
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
            .otherwise(({ data }) => (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <p className="text-sm text-ink-faint">
                        {data.total} item{data.total === 1 ? "" : "s"}
                        {data.totalPages > 1
                          ? ` · page ${data.page} of ${data.totalPages}`
                          : ""}
                      </p>

                      {/*
                        The family is the one active filter the rail does not
                        offer, so it is shown here — and removable, or a search
                        for "gold" would be a one-way door.
                      */}
                      {match(facetState.family)
                        .with("", () => null)
                        .otherwise((family) => (
                          <button
                            type="button"
                            onClick={() => update({ family: "" })}
                            className="flex items-center gap-1 rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-medium capitalize text-ink hover:bg-sunken"
                          >
                            {family}
                            <span aria-hidden="true">✕</span>
                            <span className="sr-only">Clear this color family</span>
                          </button>
                        ))}
                    </div>

                    <div className="relative">
                      <div
                        className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 xl:grid-cols-4 ${
                          results.isFetching ? "opacity-60" : "opacity-100"
                        }`}
                      >
                        {data.items.map((product) => (
                          <ProductCard key={product.id} product={product} />
                        ))}

                        {/* A full page of slots, however few results there are. */}
                        {Array.from(
                          { length: Math.max(0, data.perPage - data.items.length) },
                          (_, index) => <ProductCardSlot key={`slot-${index}`} />,
                        )}
                      </div>

                      {/*
                        Laid over the slots rather than put in their place. The
                        slots are what hold the column's height, so a page with
                        nothing on it is exactly as tall as a full one and the
                        document does not move under the pointer.
                      */}
                      {match(data.items.length)
                        .with(0, () => (
                          <div className="absolute inset-0 grid place-items-center">
                            <div className="rounded-[--radius-card] border border-dashed border-line bg-surface px-6 py-16 text-center">
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
                          </div>
                        ))
                        .otherwise(() => null)}
                    </div>

                    {/*
                      Reserved whether or not there is a second page, for the
                      same reason as the slots above.
                    */}
                    <nav
                      aria-label="Pagination"
                      className="mt-5 flex h-9 items-center justify-center gap-3"
                    >
                      {match(data.totalPages > 1)
                        .with(true, () => (
                          <>
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
                          </>
                        ))
                        .with(false, () => null)
                        .exhaustive()}
                    </nav>
                  </>
            ))}
        </section>
      </div>
    </div>
  );
};
