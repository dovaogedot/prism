import type { HomeView } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, ImageSet, Skeleton } from "../../../shared/ui/index.ts";
import { ProductRow } from "../../catalog/components/ProductRow.tsx";
import { RecentlyViewedRow } from "../../catalog/components/RecentlyViewedRow.tsx";
import { CategoryTile } from "../components/CategoryTile.tsx";

/**
 * The home page: what the shop is, the featured products, the categories,
 * the best rated, the newest, and what this browser viewed last. A row
 * with nothing in it is left out.
 */
export const HomePage = () => {
  const home = useQuery({
    queryKey: ["home"],
    queryFn: ({ signal }) => Api.get<HomeView>("/home", signal),
  });

  const seeAllClass = "text-sm font-medium text-accent underline-offset-2 hover:underline";
  const mosaic = (home.data?.featured ?? []).flatMap((product) => product.images.slice(0, 1)).slice(0, 4);

  return (
    <div className="mx-auto max-w-7xl space-y-14 px-4 py-10 sm:px-6">
      <PageMeta title={PageText.home.title} description={PageText.home.description} canonicalPath="/" />

      <section className="grid items-center gap-10 rounded-2xl border border-line bg-surface px-6 py-12 sm:px-10 sm:py-16 lg:grid-cols-[1fr_auto]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-accent">Prism</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight text-ink sm:text-5xl">Collectible pixel-art game items</h1>
          <p className="mt-4 max-w-xl text-lg text-ink-soft">
            Swords, jokers, trinkets and blocks from the games you love, rated by the players who bought them and delivered across
            Europe.
          </p>
          <Link
            className="mt-8 inline-flex rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-accent-ink shadow-sm transition-colors hover:bg-accent-hover"
            to="/shop"
          >
            Browse all products
          </Link>
        </div>

        {/* A few featured pictures beside the words on a wide page; the rows below name them. */}
        {mosaic.length < 4 ? null : (
          <div className="hidden grid-cols-2 gap-3 lg:grid" aria-hidden="true">
            {mosaic.map((image) => (
              <ImageSet className="size-36 rounded-xl border border-line bg-sunken object-contain p-3" key={image.id} image={image} sizes="9rem" isDecorative />
            ))}
          </div>
        )}
      </section>

      {home.status === "error" ? <Alert title="The shop's rows did not load">Something went wrong at our end. Try again in a moment.</Alert> : null}

      {match(home)
        .with({ status: "pending" }, () => (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton className="aspect-[3/4] w-full" key={index} />
            ))}
          </div>
        ))
        .with({ data: P.nonNullable.select() }, (data) => (
          <>
            {data.featured.length === 0 ? null : <ProductRow id="featured-heading" title="Featured" products={data.featured} />}

            {data.categories.length === 0 ? null : (
              <section className="space-y-4" aria-labelledby="categories-heading">
                <h2 className="text-xl font-semibold tracking-tight text-ink" id="categories-heading">
                  Shop by category
                </h2>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {data.categories.map((category) => (
                    <li key={category.slug}>
                      <CategoryTile category={category} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.topRated.length === 0 ? null : (
              <ProductRow
                id="top-rated-heading"
                title="Top rated"
                products={data.topRated}
                action={
                  <Link className={seeAllClass} to="/shop?sort=rating">
                    See all
                  </Link>
                }
              />
            )}

            {data.newest.length === 0 ? null : (
              <ProductRow
                id="newest-heading"
                title="New arrivals"
                products={data.newest}
                action={
                  <Link className={seeAllClass} to="/shop?sort=newest">
                    See all
                  </Link>
                }
              />
            )}
          </>
        ))
        .otherwise(() => null)}

      <RecentlyViewedRow />
    </div>
  );
};
