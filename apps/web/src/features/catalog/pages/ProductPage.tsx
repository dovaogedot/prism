import { Price, type ProductDetail } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useRef } from "react";
import { Link, useLocation, useNavigationType, useParams } from "react-router";
import { HashTarget } from "../../../shared/layout/hash-target.ts";
import { match, P } from "ts-pattern";
import { Api, ApiError } from "../../../shared/api/client.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { Alert, Card, Skeleton, Stars } from "../../../shared/ui/index.ts";
import { AddToCart } from "../../cart/components/index.ts";
import { NotFoundPage } from "../../pages/pages/NotFoundPage.tsx";
import { ReviewsSection } from "../../reviews/components/index.ts";
import { useReviewPage } from "../../reviews/reviews.ts";
import { ProductKeys, useRelatedProducts } from "../catalog.ts";
import { CatalogSeo } from "../catalog-seo.ts";
import { Gallery, Measurements, ProductJsonLd, RecentlyViewedRow, RelatedProducts, SpecRow, Stock } from "../components/index.ts";
import { RecentlyViewed } from "../recently-viewed.ts";

/**
 * One product's page: the breadcrumb trail, the pictures, the price and
 * stock with the way to the cart, the description and the details, the
 * reviews, more from the same category, and what this browser viewed last.
 * A slug no product carries gets the "not found" page.
 */
export const ProductPage = () => {
  const { slug = "" } = useParams();

  const product = useQuery({
    queryKey: ProductKeys.one(slug),
    queryFn: ({ signal }) => Api.getPublic<ProductDetail>(`/products/${slug}`, signal),
    retry: false,
  });

  // Asked for beside the product, not after it: the sections below find
  // their first page of reviews and the related products in the cache.
  useReviewPage(slug, "helpful", 1);

  useRelatedProducts(slug);

  const shown = product.data?.slug;

  const location = useLocation();

  const navigationType = useNavigationType();

  /** The navigation whose hash was brought into view, so each one is, once. */
  const revealedFor = useRef<string | undefined>(undefined);

  // A followed link to a part of the page, such as a mail's link to the
  // reviews, brings that part into view once the product has rendered it.
  useEffect(() => {
    if (shown === undefined || revealedFor.current === location.key || !HashTarget.isFollowed(navigationType, location.key)) return;

    const target = HashTarget.find(location.hash);
    if (target === null) return;

    revealedFor.current = location.key;
    target.scrollIntoView({ block: "start" });
  }, [shown, location.hash, location.key, navigationType]);

  useEffect(() => {
    if (shown !== undefined) {
      RecentlyViewed.remember(shown);
    }
  }, [shown]);

  if (product.error instanceof ApiError && product.error.status === 404) return <NotFoundPage heading="Product not found" />;

  return (
    <div className="mx-auto max-w-6xl space-y-14 px-4 py-8 sm:px-6">
      {match(product)
        .with({ status: "error" }, () => (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">This product did not load</h1>
            <Alert>Something went wrong at our end. Try again in a moment.</Alert>
          </div>
        ))
        .with({ data: P.nullish }, () => (
          <div className="grid gap-10 lg:grid-cols-2">
            <h1 className="sr-only">Loading the product</h1>
            <Skeleton className="aspect-square w-full" />
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ))
        .otherwise(({ data }) => (
          // Keyed by product, so moving to another one starts every part afresh:
          // the quantity, the picture, the reviews' page and an open review form.
          <Fragment key={data.slug}>
            <PageMeta
              title={CatalogSeo.productTitle(data)}
              description={CatalogSeo.productDescription(data)}
              canonicalPath={`/products/${data.slug}`}
            />
            <ProductJsonLd product={data} />

            <div className="space-y-6">
              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
                  <li>
                    <Link className="hover:text-ink hover:underline" to="/">
                      Home
                    </Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li>
                    <Link className="hover:text-ink hover:underline" to={`/categories/${data.category.slug}`}>
                      {data.category.name}
                    </Link>
                  </li>
                  <li aria-hidden="true">/</li>
                  <li className="truncate text-ink" aria-current="page">
                    {data.name}
                  </li>
                </ol>
              </nav>

              <article className="grid gap-10 lg:grid-cols-2">
                <Gallery images={data.images} name={data.name} />

                <div className="space-y-6">
                  <header className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                      <Link className="hover:text-ink hover:underline" to={`/shop?brand=${encodeURIComponent(data.brand.slug)}`}>
                        {data.brand.name}
                      </Link>{" "}
                      ·{" "}
                      <Link className="hover:text-ink hover:underline" to={`/categories/${data.category.slug}`}>
                        {data.category.name}
                      </Link>
                    </p>
                    <h1 className="text-3xl font-semibold tracking-tight text-ink">{data.name}</h1>
                    <a className="inline-block rounded hover:opacity-80" href="#reviews-heading">
                      <Stars rating={data.rating.average} count={data.rating.count} />
                    </a>
                  </header>

                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-semibold tabular-nums text-ink">{Price.format(data.priceCents)}</span>
                    <Stock className="text-sm" count={data.stock} />
                  </div>

                  <AddToCart product={data} />

                  <p className="whitespace-pre-line leading-relaxed text-ink-soft">{data.description}</p>

                  {data.properties.length === 0 ? null : (
                    <Card className="p-4">
                      <h2 className="mb-1 text-sm font-semibold text-ink">Details</h2>
                      <dl className="divide-y divide-line">
                        {data.properties.map((property) => (
                          <SpecRow key={property.name} label={property.name} value={property.value} />
                        ))}
                      </dl>
                    </Card>
                  )}

                  <Card className="p-4">
                    <Measurements product={data} />
                  </Card>
                </div>
              </article>
            </div>

            <ReviewsSection slug={data.slug} />
            <RelatedProducts slug={data.slug} categoryName={data.category.name} />
            <RecentlyViewedRow exclude={data.slug} />
          </Fragment>
        ))}
    </div>
  );
};
