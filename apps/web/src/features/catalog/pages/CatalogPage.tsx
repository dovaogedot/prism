/**
 * The shop.
 *
 * Filter state lives in the URL, whose query string is forwarded to
 * `GET /products` as it is, so every view is shareable and Back behaves.
 * `keepPreviousData` holds the old grid on screen while a new filter loads.
 */

import { ProductSort, type ProductSearchResult } from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useDrawer } from "../../../shared/layout/drawer.ts";
import { useWide } from "../../../shared/layout/use-wide.ts";
import { Alert, Button, Skeleton } from "../../../shared/ui/index.ts";
import { CategoryCards } from "../components/CategoryCards.tsx";
import { Facets } from "../components/Facets.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { SearchBox } from "../components/SearchBox.tsx";
import { CatalogParams } from "../filters.ts";

/** The square a control drawn as an icon sits in, beside the search box on a narrow page. */
const ICON_CONTROL =
  "grid size-[2.625rem] shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink-soft hover:border-line-strong";

/**
 * The catalog: the search box, the sort, the filter rail and the grid they
 * narrow. The rail stands beside the grid on a wide page and is in the
 * layout's drawer on a narrow one, where a button beside the sort opens it.
 */
export const CatalogPage = () => {
  const [params, setParams] = useSearchParams();
  const wide = useWide();
  const drawer = useDrawer();
  const query = params.toString();

  const results = useQuery({
    queryKey: ["products", query],
    queryFn: ({ signal }) => Api.get<ProductSearchResult>(`/products${query.length === 0 ? "" : `?${query}`}`, signal),
    placeholderData: keepPreviousData,
  });

  const sort = ProductSort.schema.catch("relevance").parse(params.get("sort") ?? "relevance");

  const goToPage = (page: number): void => {
    setParams(CatalogParams.set(params, "page", String(page)));
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  const sortOptions = ProductSort.NAMES.map((option) => (
    <option key={option} value={option}>
      {ProductSort.label[option]}
    </option>
  ));

  const rail = match(results.data)
    .with(P.nullish, () => (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-28 w-full" />
        ))}
      </div>
    ))
    .otherwise((data) => <Facets facets={data.facets} params={params} onChange={setParams} />);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-4">
        {match(results.data)
          .with(P.nullish, () => (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} className="h-[3.75rem] w-full" />
              ))}
            </div>
          ))
          .otherwise((data) => <CategoryCards buckets={data.facets.categories} params={params} onChange={setParams} />)}
      </div>

      <div className="mb-8 flex gap-2">
        <SearchBox key={params.get("q") ?? ""} value={params.get("q") ?? ""} onSubmit={(text) => setParams(CatalogParams.set(params, "q", text))} />

        {match(wide)
          .with(true, () => (
            <label className="flex items-center gap-2 text-sm">
              <span className="sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(event) => setParams(CatalogParams.set(params, "sort", event.target.value))}
                className="h-[2.625rem] rounded-lg border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong"
              >
                {sortOptions}
              </select>
            </label>
          ))
          .with(false, () => (
            <>
              {/*
                The select is laid invisibly over its icon, so a tap opens the
                phone's own picker and the control keeps its name. The icons take
                the accent while a sort or a filter is in force.
              */}
              <label className={`${ICON_CONTROL} relative focus-within:border-accent ${sort === "relevance" ? "" : "text-accent"}`}>
                <span className="sr-only">Sort by</span>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.5 19V5M4.5 8l3-3 3 3M16.5 5v14M13.5 16l3 3 3-3" />
                </svg>
                <select
                  value={sort}
                  onChange={(event) => setParams(CatalogParams.set(params, "sort", event.target.value))}
                  className="absolute inset-0 size-full cursor-pointer opacity-0"
                >
                  {sortOptions}
                </select>
              </label>

              <button
                type="button"
                aria-label="Filters"
                aria-haspopup="dialog"
                onClick={drawer.open}
                className={`${ICON_CONTROL} ${CatalogParams.isFiltered(params) ? "text-accent" : ""}`}
              >
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.9v-7.5z" />
                </svg>
              </button>
            </>
          ))
          .exhaustive()}
      </div>

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        {match({ wide, slot: drawer.slot })
          .with({ wide: true }, () => <aside>{rail}</aside>)
          .with({ slot: P.nonNullable.select() }, (slot) => createPortal(rail, slot))
          .otherwise(() => null)}

        <section aria-label="Results" aria-busy={results.isFetching} className="min-h-[70dvh]">
          {match(results)
            .with({ status: "error" }, () => (
              <Alert title="We could not load the catalog">Something went wrong at our end. Try again in a moment.</Alert>
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
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">Results</h2>
                  <span className="text-sm text-ink-faint">
                    {data.total} item{data.total === 1 ? "" : "s"}
                    {data.totalPages > 1 ? ` · page ${data.page} of ${data.totalPages}` : ""}
                  </span>

                  {CatalogParams.active(params, data.facets).map((filter) => (
                    <button
                      key={`${filter.key}=${filter.value}`}
                      type="button"
                      onClick={() => setParams(filter.next)}
                      aria-label={`Remove ${filter.label}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink"
                    >
                      {filter.label}
                      <span aria-hidden="true">×</span>
                    </button>
                  ))}
                </div>

                {match(data.items.length)
                  .with(0, () => (
                    <div className="rounded-lg border border-dashed border-line bg-surface px-6 py-16 text-center">
                      <p className="font-medium text-ink">Nothing matches that.</p>
                      <Button tone="quiet" className="mt-4" onClick={() => setParams(CatalogParams.cleared(params))}>
                        Clear all filters
                      </Button>
                    </div>
                  ))
                  .otherwise(() => (
                    <div
                      className={`grid grid-cols-2 gap-4 transition-opacity sm:grid-cols-3 xl:grid-cols-4 ${
                        results.isFetching ? "opacity-60" : "opacity-100"
                      }`}
                    >
                      {data.items.map((product) => (
                        <ProductCard key={product.id} product={product} />
                      ))}
                    </div>
                  ))}

                {match(data.totalPages > 1)
                  .with(true, () => (
                    <nav aria-label="Pagination" className="mt-5 flex items-center justify-center gap-3">
                      <Button tone="quiet" disabled={data.page <= 1} onClick={() => goToPage(data.page - 1)}>
                        Previous
                      </Button>
                      <span className="text-sm tabular-nums text-ink-soft">
                        {data.page} / {data.totalPages}
                      </span>
                      <Button tone="quiet" disabled={data.page >= data.totalPages} onClick={() => goToPage(data.page + 1)}>
                        Next
                      </Button>
                    </nav>
                  ))
                  .with(false, () => null)
                  .exhaustive()}
              </>
            ))}
        </section>
      </div>
    </div>
  );
};
