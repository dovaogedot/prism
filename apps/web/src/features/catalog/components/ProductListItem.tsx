import { Price, type ProductSummary } from "@prism/shared";
import { Link } from "react-router";
import { Stars } from "../../../shared/ui/index.ts";
import { Picture } from "./Picture.tsx";
import { Stock } from "./Stock.tsx";

/** The product the row shows. */
export type ProductListItemProps = Readonly<{ product: ProductSummary }>;

/** A product as a row of the list view: the picture beside its name, brand, category, rating, price and stock. */
export const ProductListItem = ({ product }: ProductListItemProps) => (
  <article className="group relative flex gap-4 rounded-lg border border-line bg-surface p-3 transition-all hover:border-line-strong hover:shadow-md">
    <Picture className="size-24 shrink-0 rounded-md sm:size-28" image={product.images[0]} name={product.name} sizes="7rem" />

    <div className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-6">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-xs font-medium uppercase tracking-wider text-ink-faint">
          {product.brand.name} · {product.category.name}
        </p>
        <h3 className="line-clamp-2 font-semibold leading-snug text-ink group-hover:text-accent">
          <Link className="after:absolute after:inset-0 after:content-['']" to={`/products/${product.slug}`}>
            {product.name}
          </Link>
        </h3>
        <Stars rating={product.rating.average} count={product.rating.count} />
      </div>

      <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span className="text-lg font-semibold tabular-nums text-ink">{Price.format(product.priceCents)}</span>
        <Stock className="text-xs" count={product.stock} />
      </div>
    </div>
  </article>
);
