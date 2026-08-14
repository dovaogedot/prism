import { formatPrice, isCents, type ProductSummary } from "@hue/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Stars } from "./primitives.tsx";
import { Swatch } from "./Swatch.tsx";

const price = (cents: number): string =>
  isCents(cents) ? formatPrice(cents) : "—";

export const ProductCard = ({ product }: Readonly<{ product: ProductSummary }>) => (
  <Link
    to={`/colour/${product.slug}`}
    className="group flex flex-col overflow-hidden rounded-[--radius-card] border border-line bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg"
  >
    <Swatch
      hex={product.hex}
      image={product.primaryImage}
      alt={`${product.name} — ${product.hex}`}
      caption={product.hex}
      className="aspect-square w-full"
    />

    <div className="flex flex-1 flex-col gap-2 p-3.5">
      <div className="space-y-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">
          {product.brand.name}
        </p>
        <h3 className="text-sm font-semibold leading-snug text-ink group-hover:text-accent">
          {product.name}
        </h3>
      </div>

      <Stars rating={product.rating.average} count={product.rating.count} />

      <div className="mt-auto flex items-baseline justify-between pt-1">
        <span className="text-base font-semibold tabular-nums text-ink">
          {price(product.priceCents)}
        </span>

        {match(product.stockQuantity)
          .with(0, () => (
            <span className="text-xs font-medium text-danger">Out of stock</span>
          ))
          .with(P.number.lte(8), (remaining) => (
            <span className="text-xs text-ink-faint">Only {remaining} left</span>
          ))
          .otherwise(() => (
            <span className="text-xs capitalize text-ink-faint">{product.finish}</span>
          ))}
      </div>
    </div>
  </Link>
);
