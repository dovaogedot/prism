import { Price, type ProductSummary } from "@prism/shared";
import { Link } from "react-router";
import { Stars } from "../../../shared/ui/index.ts";
import { Picture } from "./Picture.tsx";
import { Stock } from "./Stock.tsx";

/** The product the card shows. */
export type ProductCardProps = Readonly<{ product: ProductSummary }>;

/** A product in a grid: its picture, name, brand, rating and price. The whole card is the link to its page. */
export const ProductCard = ({ product }: ProductCardProps) => (
  <article className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-all hover:border-line-strong hover:shadow-lg">
    <Picture
      className="aspect-square w-full"
      image={product.images[0]}
      name={product.name}
      sizes="(min-width: 1280px) 18rem, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
    />

    <div className="flex flex-1 flex-col gap-2 p-3">
      <div className="space-y-0.5">
        <p className="truncate text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">{product.brand.name}</p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink group-hover:text-accent">
          {/* The link covers the whole card, so anywhere on it is a click target. */}
          <Link className="after:absolute after:inset-0 after:content-['']" to={`/products/${product.slug}`}>
            {product.name}
          </Link>
        </h3>
      </div>

      <Stars rating={product.rating.average} count={product.rating.count} />

      <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
        <span className="text-base font-semibold tabular-nums text-ink">{Price.format(product.priceCents)}</span>
        <Stock className="text-xs" count={product.stock} />
      </div>
    </div>
  </article>
);
