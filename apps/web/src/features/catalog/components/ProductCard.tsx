import { Price, type ProductImage, type ProductSummary } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Stars } from "../../../shared/ui/index.ts";

/** The first picture, whole inside its box, or a plain block where there is none. */
export const Picture = ({ image, name, className }: Readonly<{ image: ProductImage | undefined; name: string; className: string }>) =>
  match(image)
    .with(P.nullish, () => (
      <div className={`${className} grid place-items-center bg-sunken text-3xl font-semibold text-ink-faint`} aria-hidden="true">
        {name.slice(0, 1)}
      </div>
    ))
    .otherwise((found) => <img src={found.url} alt={found.alt} loading="lazy" className={`${className} bg-sunken object-contain`} />);

/** How many are left, in the three steps the shop distinguishes. */
export const Stock = ({ count, className }: Readonly<{ count: number; className: string }>) =>
  match(count)
    .with(0, () => <span className={`${className} font-medium text-danger`}>Out of stock</span>)
    .with(P.number.lte(5), (remaining) => <span className={`${className} font-medium text-warn`}>Only {remaining} left</span>)
    .otherwise(() => <span className={`${className} text-ink-faint`}>In stock</span>);

/** A product in the grid: its picture, name, brand, rating and price. */
export const ProductCard = ({ product }: Readonly<{ product: ProductSummary }>) => (
  <article className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-surface transition-all hover:border-line-strong hover:shadow-lg">
    <Picture image={product.images[0]} name={product.name} className="aspect-square w-full" />

    <div className="flex flex-1 flex-col gap-2 p-3">
      <div className="space-y-0.5">
        <p className="truncate text-[11px] font-medium uppercase tracking-wider text-ink-faint">{product.brand.name}</p>
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink group-hover:text-accent">
          {/* The link covers the whole card, so anywhere on it is a click target. */}
          <Link to={`/item/${product.slug}`} className="after:absolute after:inset-0 after:content-['']">
            {product.name}
          </Link>
        </h3>
      </div>

      <Stars rating={product.rating.average} count={product.rating.count} />

      <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
        <span className="text-base font-semibold tabular-nums text-ink">{Price.format(product.priceCents)}</span>
        <Stock count={product.stock} className="text-xs" />
      </div>
    </div>
  </article>
);
