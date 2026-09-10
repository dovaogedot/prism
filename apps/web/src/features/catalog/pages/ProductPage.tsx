/**
 * One product, whichever of the three it is.
 *
 * The measurements block is where the metric/imperial requirement shows up:
 * the server sends both, derived from one set of metric values, and the toggle
 * picks which vocabulary to read them in. Which rows those are follows from
 * what the product is, and that reading lives in `@prism/shared` — this page
 * prints the rows it is handed.
 *
 * The spec block above it is the variant part of the product, and it is
 * rendered by matching on the variant.
 */

import {
  describeApplication,
  DIRECTION_LABELS,
  finishAmount,
  FINISH_AXIS_LABELS,
  formatPrice,
  isCents,
  KIND_LABELS,
  type Measurements,
  measurementRows,
  Option,
  type ProductDetail,
  type ProductSpec,
  type UnitSystem,
} from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { api } from "../../../shared/api/client.ts";
import { Artwork } from "../components/Artwork.tsx";
import { Gallery } from "../components/Gallery.tsx";
import { Alert, Card, Skeleton, Stars } from "../../../shared/ui/index.ts";

const Spec = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm text-ink-soft">{label}</dt>
    <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
  </div>
);

/** Six words each, since nobody has met any of these numbers before. */
const MEASUREMENT_NOTES: Record<Measurements["of"], string> = {
  color:
    "How warm it burns, how far it still reads, how thick the layer over it is, and how heavy it looks.",
  finisher:
    "The one dimension the effect it sells has, and how heavy it is.",
  shifter:
    "How hard it has to turn, how much play there is before the color moves, and how heavy the gear is.",
};

const MeasurementBlock = ({ product }: Readonly<{ product: ProductDetail }>) => {
  const [system, setSystem] = useState<UnitSystem>("metric");

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Measurements</h2>

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
        {measurementRows(product.measurements, system).map((row) => (
          <Spec key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>

      {/*
        Properties of the thing itself — none of them describes a container,
        because there is no container.
      */}
      <p className="mt-2 text-xs leading-relaxed text-ink-faint">
        {MEASUREMENT_NOTES[product.measurements.of]}
      </p>
    </div>
  );
};

/**
 * The amounts a finish is made of, less the coating.
 *
 * Both of them, always: they are independent, so a zero is a fact about the
 * thing rather than a row that failed to apply. The coating is absent here
 * because it is a thickness, and a thickness is a measurement — it appears in
 * the block below, where the unit it is read in can be chosen.
 */
const FinishRows = ({
  finishing,
}: Readonly<{ finishing: Readonly<{ roughness: number; emission: number }> }>) => (
  <>
    <Spec label="Roughness" value={`${finishing.roughness}%`} />
    <Spec label="Emission" value={`${finishing.emission}%`} />
  </>
);

/**
 * The variant half of the product. Each kind lists exactly the facts it has:
 * there is no row here that says "—" because this particular product happens
 * not to be a color.
 */
const SpecRows = ({ spec }: Readonly<{ spec: ProductSpec }>) =>
  match(spec)
    .with({ kind: "color" }, (color) => (
      <>
        <Spec label="Hex" value={color.hex} />
        <Spec label="Hue" value={`${color.hue}°`} />
        <Spec label="Saturation" value={`${color.saturation}%`} />
        <Spec label="Lightness" value={`${color.lightness}%`} />
        <FinishRows finishing={color} />
      </>
    ))
    // One row, because a finisher carries one amount. Which amount it is names the
    // row, so there is never a row here reading zero for something the finisher
    // does not do.
    .with({ kind: "finisher" }, (finisher) => (
      <Spec
        label={FINISH_AXIS_LABELS[finisher.applies]}
        value={finishAmount(finisher)}
      />
    ))
    .with({ kind: "shifter" }, (shifter) => (
      <>
        <Spec label="Direction" value={DIRECTION_LABELS[shifter.direction]} />
        <Spec label="Arc" value={`${shifter.arcDegrees}°`} />
      </>
    ))
    .exhaustive();

/** What the spec block is called, which is not the same on all three shelves. */
const SPEC_TITLES: Record<ProductSpec["kind"], string> = {
  color: "The color",
  finisher: "The finisher",
  shifter: "The shifter",
};

/** One product's page, reached by its slug. */
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
          <Alert title="No such item">
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
            {/*
              A finisher carries a set of pictures rather than one: it holds no
              color of its own, so what it has to show is what it does to four
              that do. The first of them is where its room is drawn, and the
              rest stay photographs. The other two kinds carry at most one
              picture and are drawn from their own numbers.
            */}
            {match(data)
              .with(
                { spec: { kind: "finisher" }, images: [P.any, ...P.array()] },
                ({ spec, images, name }) => (
                  <Gallery
                    key={data.slug}
                    images={images}
                    lead={(frame) => (
                      <Artwork
                        spec={spec}
                        name={name}
                        image={Option.some(images[0])}
                        className={frame}
                      />
                    )}
                    alt={`${name} — ${describeApplication(spec)}`}
                  />
                ),
              )
              .otherwise(() => (
                <Artwork
                  spec={data.spec}
                  name={data.name}
                  image={data.primaryImage}
                  className="aspect-square w-full rounded-[--radius-card] border border-line"
                />
              ))}

            <div className="space-y-6">
              <header className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
                  <Link
                    to={`/?brands=${data.brand.slug}`}
                    className="hover:text-accent"
                  >
                    {data.brand.name}
                  </Link>
                  <span aria-hidden="true">·</span>
                  <Link
                    to={`/?category=${data.spec.kind}`}
                    className="hover:text-accent"
                  >
                    {KIND_LABELS[data.spec.kind]}
                  </Link>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-ink">
                  {data.name}
                </h1>
                <Stars rating={data.rating.average} count={data.rating.count} />
              </header>

              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums text-ink">
                  {isCents(data.priceCents) ? formatPrice(data.priceCents) : "—"}
                </span>
                {/* Same three-step scale as the grid: faint, amber, red. */}
                {match(data.stockQuantity)
                  .with(0, () => (
                    <span className="text-sm font-medium text-danger">
                      Out of stock
                    </span>
                  ))
                  .with(P.number.lte(8), (quantity) => (
                    <span className="text-sm font-medium text-warn">
                      Only {quantity} left
                    </span>
                  ))
                  .otherwise((quantity) => (
                    <span className="text-sm text-ink-faint">
                      {quantity} in stock
                    </span>
                  ))}
              </div>

              <p className="leading-relaxed text-ink-soft">{data.description}</p>

              <Card className="p-4">
                <h2 className="mb-1 text-sm font-semibold text-ink">
                  {SPEC_TITLES[data.spec.kind]}
                </h2>
                <dl className="divide-y divide-line">
                  <SpecRows spec={data.spec} />
                </dl>
              </Card>

              <Card className="p-4">
                <MeasurementBlock product={data} />
              </Card>

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
