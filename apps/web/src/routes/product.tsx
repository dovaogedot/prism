/**
 * One colour.
 *
 * The measurements block is where the metric/imperial requirement shows up:
 * the server sends both, derived from one stored set of metric values, and the
 * toggle just picks which vocabulary to read them in.
 */

import { formatPrice, isCents, type ProductDetail } from "@hue/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { api } from "../lib/api.ts";
import { Swatch } from "../components/Swatch.tsx";
import { Alert, Card, Skeleton, Stars } from "../components/primitives.tsx";

type UnitSystem = "metric" | "imperial";

const Spec = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm text-ink-soft">{label}</dt>
    <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
  </div>
);

const Measurements = ({ product }: Readonly<{ product: ProductDetail }>) => {
  const [system, setSystem] = useState<UnitSystem>("metric");
  const { metric, imperial } = product.measurements;

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">The vial</h2>

        <div
          role="group"
          aria-label="Unit system"
          className="flex rounded-lg border border-line p-0.5"
        >
          {(["metric", "imperial"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSystem(option)}
              aria-pressed={system === option}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                system === option
                  ? "bg-accent text-accent-ink"
                  : "text-ink-soft hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <dl className="divide-y divide-line">
        {match(system)
          .with("metric", () => (
            <>
              <Spec label="Weight" value={`${metric.weightGrams} g`} />
              <Spec
                label="Dimensions"
                value={`${metric.lengthMillimetres} × ${metric.widthMillimetres} × ${metric.heightMillimetres} mm`}
              />
            </>
          ))
          .with("imperial", () => (
            <>
              <Spec
                label="Weight"
                value={`${imperial.weightOunces} oz (${imperial.weightPounds} lb)`}
              />
              <Spec
                label="Dimensions"
                value={`${imperial.lengthInches} × ${imperial.widthInches} × ${imperial.heightInches} in`}
              />
            </>
          ))
          .exhaustive()}
      </dl>
    </div>
  );
};

export const ProductPage = () => {
  const { slug = "" } = useParams();

  const product = useQuery({
    queryKey: ["product", slug],
    queryFn: ({ signal }) => api.get<ProductDetail>(`/products/${slug}`, signal),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        <span aria-hidden="true">←</span> Back to the shop
      </Link>

      {match(product)
        .with({ status: "error" }, () => (
          <Alert title="No such colour">
            We could not find that one. It may have been discontinued.
          </Alert>
        ))
        .with({ data: P.nullish }, () => (
          <div className="grid gap-10 lg:grid-cols-2">
            <Skeleton className="aspect-square w-full" />
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-5 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </div>
        ))
        .otherwise(({ data }) => (
          <article className="grid gap-10 lg:grid-cols-2">
            <Swatch
              hex={data.hex}
              image={data.primaryImage}
              alt={`${data.name} — ${data.hex}`}
              className="aspect-square w-full rounded-[--radius-card] border border-line"
            />

            <div className="space-y-6">
              <header className="space-y-2">
                <Link
                  to={`/?brands=${data.brand.slug}`}
                  className="text-xs font-medium uppercase tracking-wider text-ink-faint hover:text-accent"
                >
                  {data.brand.name}
                </Link>
                <h1 className="text-3xl font-semibold tracking-tight text-ink">
                  {data.name}
                </h1>
                <Stars rating={data.rating.average} count={data.rating.count} />
              </header>

              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums text-ink">
                  {isCents(data.priceCents) ? formatPrice(data.priceCents) : "—"}
                </span>
                {match(data.stockQuantity)
                  .with(0, () => (
                    <span className="text-sm font-medium text-danger">
                      Out of stock
                    </span>
                  ))
                  .otherwise((quantity) => (
                    <span className="text-sm text-ink-faint">
                      {quantity} vials in stock
                    </span>
                  ))}
              </div>

              <p className="leading-relaxed text-ink-soft">{data.description}</p>

              <Card className="p-4">
                <h2 className="mb-1 text-sm font-semibold text-ink">The colour</h2>
                <dl className="divide-y divide-line">
                  <Spec label="Hex" value={data.hex} />
                  <Spec label="Hue" value={`${data.hue}°`} />
                  <Spec label="Saturation" value={`${data.saturation}%`} />
                  <Spec label="Lightness" value={`${data.lightness}%`} />
                  <Spec
                    label="Finish"
                    value={data.finish.charAt(0).toUpperCase() + data.finish.slice(1)}
                  />
                  <Spec label="Category" value={data.category.name} />
                </dl>
              </Card>

              <Card className="p-4">
                <Measurements product={data} />
              </Card>

              {/* Project 2 turns this on. */}
              <button
                type="button"
                disabled
                title="Carts arrive in project 2"
                className="w-full cursor-not-allowed rounded-lg border border-dashed border-line py-3 text-sm font-medium text-ink-faint"
              >
                Add to cart — coming in project 2
              </button>

              {match(data.reviews.length)
                .with(0, () => null)
                .otherwise(() => (
                  <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-ink">
                      What people said
                    </h2>
                    <ul className="space-y-3">
                      {data.reviews.slice(0, 5).map((review) => (
                        <li
                          key={review.id}
                          className="rounded-lg border border-line bg-surface p-3.5"
                        >
                          <div className="mb-1.5 flex items-center gap-2.5">
                            <span
                              aria-hidden="true"
                              className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-xs font-semibold text-ink-soft"
                            >
                              {review.authorInitial}
                            </span>
                            <Stars rating={review.rating} count={1} />
                          </div>
                          <p className="text-sm text-ink-soft">{review.body}</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </div>
          </article>
        ))}
    </div>
  );
};
