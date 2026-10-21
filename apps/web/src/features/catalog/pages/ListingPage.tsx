import { ProductSort, type ProductSearchResult } from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Navigate, useParams, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useDrawer } from "../../../shared/layout/drawer.ts";
import { useWide } from "../../../shared/layout/use-wide.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, EmptyState, Pagination, Skeleton } from "../../../shared/ui/index.ts";
import { NotFoundPage } from "../../pages/pages/NotFoundPage.tsx";
import { CatalogSeo } from "../catalog-seo.ts";
import { useCategories } from "../catalog.ts";
import { CategoryNav, type CategoryLink } from "../components/CategoryNav.tsx";
import { Facets } from "../components/Facets.tsx";
import { ProductCard } from "../components/ProductCard.tsx";
import { ProductListItem } from "../components/ProductListItem.tsx";
import { ViewToggle } from "../components/ViewToggle.tsx";
import { CatalogParams } from "../filters.ts";
import { Listing, type ListingKind } from "../listing.ts";

/** Which address the listing is drawn for. */
export type ListingPageProps = Readonly<{ kind: ListingKind }>;

/**
 * The catalog's one listing, behind `/shop`, `/categories/:slug` and
 * `/search`: the categories, the filter rail, the sort, the grid or list,
 * and the pages. The filters live in the URL, whose query string is
 * forwarded to `GET /products`, so every view is a link and Back behaves.
 * The rail stands beside the results on a wide page and is in the layout's
 * drawer on a narrow one.
 */
export const ListingPage = ({ kind }: ListingPageProps) => {
  const { slug } = useParams();

  const [params, setParams] = useSearchParams();

  const wide = useWide();

  const drawer = useDrawer();

  const categories = useCategories();

  const category = kind === "category" ? slug : undefined;
  const query = Listing.apiQuery(params, category);

  const results = useQuery({
    queryKey: ["products", query],
    queryFn: ({ signal }) => Api.get<ProductSearchResult>(`/products${query.length === 0 ? "" : `?${query}`}`, signal),
    placeholderData: keepPreviousData,
  });

  const redirect = kind === "shop" ? Listing.categoryRedirect(params) : undefined;
  if (redirect !== undefined) return <Navigate to={redirect} replace />;

  const shelf = categories.data?.find((candidate) => candidate.slug === category);
  if (kind === "category" && categories.data !== undefined && shelf === undefined) return <NotFoundPage heading="Category not found" />;

  const text = params.get("q") ?? "";
  const itemsOf = (count: number): string => `${count} ${count === 1 ? "item" : "items"}`;
  const view = Listing.view(params);
  const sort = ProductSort.schema.catch("relevance").parse(params.get("sort") ?? "relevance");

  const heading = match(kind)
    .with("shop", () => PageText.shop.title)
    .with("category", () => shelf?.name ?? "Category")
    .with("search", () => (text.length === 0 ? "Search" : `Results for "${text}"`))
    .exhaustive();

  const meta = match(kind)
    .with("shop", () => <PageMeta title={PageText.shop.title} description={PageText.shop.description} />)
    .with("category", () =>
      shelf === undefined ? (
        <PageMeta title={heading} description={PageText.shop.description} isIndexed={false} />
      ) : (
        <PageMeta title={CatalogSeo.categoryTitle(shelf)} description={CatalogSeo.categoryDescription(shelf)} canonicalPath={`/categories/${shelf.slug}`} />
      ),
    )
    .with("search", () => <PageMeta title={heading} description={PageText.search.description} isIndexed={false} />)
    .exhaustive();

  // On a search, a category narrows the results; elsewhere each one is its own page.
  const links: readonly CategoryLink[] = match(kind)
    .with("search", () => [
      { label: "All categories", href: `/search?${CatalogParams.set(params, "category", "").toString()}`, isCurrent: params.get("category") === null },
      ...(categories.data ?? []).map((candidate) => ({
        label: candidate.name,
        href: `/search?${CatalogParams.set(params, "category", candidate.slug).toString()}`,
        isCurrent: params.get("category") === candidate.slug,
      })),
    ])
    .otherwise(() => [
      { label: "All products", href: "/shop", isCurrent: kind === "shop" },
      ...(categories.data ?? []).map((candidate) => ({
        label: candidate.name,
        href: `/categories/${candidate.slug}`,
        isCurrent: candidate.slug === category,
        count: candidate.productCount,
      })),
    ]);

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
    .with(undefined, () => (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton className="h-28 w-full" key={index} />
        ))}
      </div>
    ))
    .otherwise((data) => <Facets facets={data.facets} params={params} onChange={setParams} />);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      {meta}

      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">{heading}</h1>
        {shelf?.description === undefined ? null : <p className="max-w-3xl text-ink-soft">{shelf.description}</p>}
      </header>

      <CategoryNav links={links} />

      <div className="grid gap-8 lg:grid-cols-[15rem_1fr]">
        {match({ wide, slot: drawer.slot })
          .with({ wide: true }, () => <aside aria-label="Filters">{rail}</aside>)
          .with({ slot: P.nonNullable.select() }, (slot) => createPortal(rail, slot))
          .otherwise(() => null)}

        <section className="min-h-[70dvh]" aria-labelledby="results-heading" aria-busy={results.isFetching}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-base font-semibold text-ink" id="results-heading">
              {results.data === undefined ? "Loading products" : itemsOf(results.data.total)}
              {results.data !== undefined && results.data.totalPages > 1 ? (
                <span className="ml-2 text-sm font-normal text-ink-faint">
                  page {results.data.page} of {results.data.totalPages}
                </span>
              ) : null}
            </h2>

            {wide ? null : (
              <Button tone="quiet" type="button" aria-haspopup="dialog" onClick={drawer.open} className={CatalogParams.isFiltered(params) ? "!border-accent" : ""}>
                Filters
              </Button>
            )}

            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <span className="sr-only sm:not-sr-only">Sort by</span>
              <select
                className="h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink hover:border-line-strong"
                value={sort}
                onChange={(event) => setParams(CatalogParams.set(params, "sort", event.target.value))}
              >
                {sortOptions}
              </select>
            </label>

            <ViewToggle view={view} onChange={(next) => setParams(Listing.withView(params, next))} />
          </div>

          {results.data?.matched === "similar" ? (
            <p className="mb-3 rounded-lg border border-accent/30 bg-accent-wash px-4 py-3 text-sm text-ink" role="status">
              No exact matches for "{text}". Showing similar names.
            </p>
          ) : null}

          {results.data === undefined ? null : (
            <div className="mb-4 flex flex-wrap gap-2">
              {CatalogParams.active(params, results.data.facets).map((filter) => (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-0.5 text-xs text-ink-soft hover:border-line-strong hover:text-ink"
                  key={`${filter.key}=${filter.value}`}
                  type="button"
                  onClick={() => setParams(filter.next)}
                  aria-label={`Remove ${filter.label}`}
                >
                  {filter.label}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
          )}

          {match(results)
            .with({ status: "error" }, () => <Alert title="We could not load the products">Something went wrong at our end. Try again in a moment.</Alert>)
            .with({ data: P.nullish }, () => (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 8 }, (_, index) => (
                  <Skeleton className="aspect-[3/4] w-full" key={index} />
                ))}
              </div>
            ))
            .when(
              ({ data }) => data.items.length === 0,
              () => (
                <EmptyState
                  title={kind === "search" && text.length > 0 ? `Nothing matches "${text}".` : "Nothing matches that."}
                  action={
                    CatalogParams.isFiltered(params) ? (
                      <Button tone="quiet" type="button" onClick={() => setParams(CatalogParams.cleared(params))}>
                        Clear all filters
                      </Button>
                    ) : undefined
                  }
                >
                  {kind === "search" ? "Check the spelling, or try fewer or shorter words." : "Try another filter, or another category."}
                </EmptyState>
              ),
            )
            .otherwise(({ data }) => (
              <ul
                className={`transition-opacity ${results.isFetching ? "opacity-60" : "opacity-100"} ${
                  view === "grid" ? "grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4" : "space-y-3"
                }`}
              >
                {data.items.map((product) => (
                  <li className="grid grid-cols-1" key={product.id}>
                    {view === "grid" ? <ProductCard product={product} /> : <ProductListItem product={product} />}
                  </li>
                ))}
              </ul>
            ))}

          {results.data === undefined ? null : (
            <Pagination page={results.data.page} totalPages={results.data.totalPages} label="Result pages" onPage={goToPage} />
          )}
        </section>
      </div>
    </div>
  );
};
