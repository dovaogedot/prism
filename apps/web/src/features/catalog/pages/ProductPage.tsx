import { Price, type ProductDetail } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Card, Skeleton, Stars } from "../../../shared/ui/index.ts";
import { Picture, Stock } from "../components/ProductCard.tsx";

/** One row of a specification list. */
const Spec = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm capitalize text-ink-soft">{label}</dt>
    <dd className="text-sm font-medium tabular-nums text-ink">{value}</dd>
  </div>
);

/** The weight and the box, read in either unit system. */
const Measurements = ({ product }: Readonly<{ product: ProductDetail }>) => {
  const [system, setSystem] = useState<"metric" | "imperial">("metric");

  const rows = match(system)
    .with("metric", () => {
      const { width, height, depth } = product.dimensions.millimeters;
      return [
        { label: "Weight", value: `${product.weight.grams} g` },
        { label: "Size", value: `${width} × ${height} × ${depth} mm` },
      ];
    })
    .with("imperial", () => {
      const { width, height, depth } = product.dimensions.inches;
      return [
        { label: "Weight", value: `${product.weight.ounces} oz` },
        { label: "Size", value: `${width} × ${height} × ${depth} in` },
      ];
    })
    .exhaustive();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Measurements</h2>

        <div role="group" aria-label="Unit system" className="flex rounded-lg border border-line p-0.5">
          {(["metric", "imperial"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSystem(option)}
              aria-pressed={system === option}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                system === option ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
              }`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <Spec key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </div>
  );
};

/** One product's page, reached by its slug. */
export const ProductPage = () => {
  const { slug = "" } = useParams();

  const product = useQuery({
    queryKey: ["product", slug],
    queryFn: ({ signal }) => Api.get<ProductDetail>(`/products/${slug}`, signal),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink">
        <span aria-hidden="true">←</span> Back to the shop
      </Link>

      {match(product)
        .with({ status: "error" }, () => <Alert title="No such product">We could not find that one.</Alert>)
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
            <div className="space-y-3">
              <Picture image={data.images[0]} name={data.name} className="aspect-square w-full rounded-[--radius-card] border border-line" />

              {match(data.images.length > 1)
                .with(true, () => (
                  <div className="grid grid-cols-4 gap-3">
                    {data.images.slice(1).map((image) => (
                      <img key={image.url} src={image.url} alt={image.alt} className="aspect-square w-full rounded-lg border border-line object-cover" />
                    ))}
                  </div>
                ))
                .with(false, () => null)
                .exhaustive()}
            </div>

            <div className="space-y-6">
              <header className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-faint">
                  <Link to={`/?brand=${data.brand.slug}`} className="hover:text-accent">
                    {data.brand.name}
                  </Link>
                  <span aria-hidden="true">·</span>
                  <Link to={`/?category=${data.category.slug}`} className="hover:text-accent">
                    {data.category.name}
                  </Link>
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-ink">{data.name}</h1>
                <Stars rating={data.rating.average} count={data.rating.count} />
              </header>

              <div className="flex items-baseline gap-3">
                <span className="text-3xl font-semibold tabular-nums text-ink">{Price.format(data.priceCents)}</span>
                <Stock count={data.stock} className="text-sm" />
              </div>

              <p className="leading-relaxed text-ink-soft">{data.description}</p>

              {match(data.properties.length)
                .with(0, () => null)
                .otherwise(() => (
                  <Card className="p-4">
                    <h2 className="mb-1 text-sm font-semibold text-ink">Details</h2>
                    <dl className="divide-y divide-line">
                      {data.properties.map((property) => (
                        <Spec key={property.name} label={property.name} value={property.value} />
                      ))}
                    </dl>
                  </Card>
                ))}

              <Card className="p-4">
                <Measurements product={data} />
              </Card>
            </div>
          </article>
        ))}
    </div>
  );
};
