/**
 * One product, whichever of the three it is.
 *
 * The measurements block is where the metric/imperial requirement shows up:
 * the server sends both, derived from one set of metric values it derived in
 * turn, and the toggle just picks which vocabulary to read them in. All three
 * kinds have all three measurements — each computed from whatever that kind
 * actually carries — so the block is the same on every page.
 *
 * The spec block above it is not: it is the variant part of the product, and
 * it is rendered by matching on the variant.
 */

import {
  DIRECTION_LABELS,
  formatPrice,
  isCents,
  KIND_LABELS,
  type Measurements,
  type ProductDetail,
  type ProductSpec,
} from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { api } from "../../../shared/api/client.ts";
import { Artwork } from "../components/Artwork.tsx";
import { Alert, Card, Skeleton, Stars } from "../../../shared/ui/index.ts";

type UnitSystem = "metric" | "imperial";

const Spec = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm text-ink-soft">{label}</dt>
    <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
  </div>
);

/**
 * The measurement rows, which differ by kind because what there is to measure
 * differs by kind. A tin of finisher has no temperature and no reach; it has a
 * coverage and a grain. A shifter is a mechanism, so it has a torque and the
 * play in its gear. Weight is the one all three share.
 *
 * Kelvin is deliberately absent. It is what the column stores, being the unit
 * the derivation is defined in, but "6208 K" describes a light source rather
 * than this color — °C and °F are the two a shopper can act on.
 */
const MeasurementRows = ({
  measurements,
  system,
}: Readonly<{ measurements: Measurements; system: UnitSystem }>) =>
  match([measurements, system] as const)
    .with([{ of: "color" }, "metric"], ([{ metric }]) => (
      <>
        <Spec label="Temperature" value={`${metric.temperatureCelsius} °C`} />
        <Spec label="Reach" value={`${metric.reachMeters} m`} />
        <Spec label="Weight" value={`${metric.weightGrams} g`} />
      </>
    ))
    .with([{ of: "color" }, "imperial"], ([{ imperial }]) => (
      <>
        <Spec label="Temperature" value={`${imperial.temperatureFahrenheit} °F`} />
        <Spec label="Reach" value={`${imperial.reachFeet} ft`} />
        <Spec label="Weight" value={`${imperial.weightOunces} oz`} />
      </>
    ))
    .with([{ of: "finisher" }, "metric"], ([{ metric }]) => (
      <>
        <Spec label="Coverage" value={`${metric.coverageSquareMeters} m²`} />
        <Spec label="Grain" value={`${metric.grainMicrometers} µm`} />
        <Spec label="Weight" value={`${metric.weightGrams} g`} />
      </>
    ))
    .with([{ of: "finisher" }, "imperial"], ([{ imperial }]) => (
      <>
        <Spec label="Coverage" value={`${imperial.coverageSquareFeet} ft²`} />
        <Spec label="Grain" value={`${imperial.grainMils} mil`} />
        <Spec label="Weight" value={`${imperial.weightOunces} oz`} />
      </>
    ))
    .with([{ of: "shifter" }, "metric"], ([{ metric }]) => (
      <>
        <Spec label="Torque" value={`${metric.torqueNewtonMeters} N·m`} />
        <Spec label="Backlash" value={`${metric.backlashMillimeters} mm`} />
        <Spec label="Weight" value={`${metric.weightGrams} g`} />
      </>
    ))
    .with([{ of: "shifter" }, "imperial"], ([{ imperial }]) => (
      <>
        <Spec label="Torque" value={`${imperial.torquePoundFeet} lbf·ft`} />
        <Spec label="Backlash" value={`${imperial.backlashInches} in`} />
        <Spec label="Weight" value={`${imperial.weightOunces} oz`} />
      </>
    ))
    .exhaustive();

/** Six words each, since nobody has met any of these numbers before. */
const MEASUREMENT_NOTES: Record<Measurements["of"], string> = {
  color: "How warm it burns, how far it still reads, and how heavy it looks.",
  finisher:
    "How much surface it will see through, how much texture it leaves, and how heavy the tin is.",
  shifter:
    "How hard it has to turn, how much play there is before the color moves, and how heavy the gear is.",
};

const Measurements = ({ product }: Readonly<{ product: ProductDetail }>) => {
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
        <MeasurementRows measurements={product.measurements} system={system} />
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
        <Spec
          label="Finish"
          value={color.finish.charAt(0).toUpperCase() + color.finish.slice(1)}
        />
      </>
    ))
    .with({ kind: "finisher" }, (finisher) => (
      <>
        <Spec
          label="Applies"
          value={
            finisher.finish.charAt(0).toUpperCase() + finisher.finish.slice(1)
          }
        />
        <Spec
          label="Durability"
          value={`${finisher.durability} color${finisher.durability === 1 ? "" : "s"}`}
        />
      </>
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
            <Artwork
              spec={data.spec}
              name={data.name}
              image={data.primaryImage}
              className="aspect-square w-full rounded-[--radius-card] border border-line"
            />

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
                  {/*
                    The whole chain, as on the swatches in the grid — an acid is
                    a yellow too, and showing only the leaf hid that. Each one
                    is a filter, so each links back to it. The category is not
                    among them; it is in the header, beside the foundry.
                  */}
                  {match(data.tags.length)
                    .with(0, () => null)
                    .otherwise(() => (
                      <div className="flex items-baseline justify-between gap-4 py-2">
                        <dt className="text-sm text-ink-soft">
                          {data.tags.length === 1 ? "Tag" : "Tags"}
                        </dt>
                        <dd className="flex flex-wrap justify-end gap-1">
                          {data.tags.map((tag) => (
                            <Link
                              key={tag.slug}
                              to={`/?tag=${tag.slug}`}
                              className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-ink-soft hover:bg-accent-wash hover:text-ink"
                            >
                              {tag.name}
                            </Link>
                          ))}
                        </dd>
                      </div>
                    ))}
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
