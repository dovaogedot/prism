/**
 * One color in the grid.
 *
 * The card is an `<article>` rather than a link, because the tags on it are
 * buttons and an anchor may not contain them. The title's link stretches over
 * the whole card with a pseudo-element instead, so the card still behaves like
 * one click target — except where a tag deliberately sits on top of it.
 *
 * Everything on it has to earn its height: the grid of these must stay shorter
 * than the filter rail beside it, or filtering changes the page height and
 * takes the scroll position with it.
 */

import { formatPrice, isCents, type FacetBucket, type ProductSummary } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Stars } from "../../../shared/ui/index.ts";
import { Swatch } from "./Swatch.tsx";

const price = (cents: number): string =>
  isCents(cents) ? formatPrice(cents) : "—";

export type ProductCardProps = Readonly<{
  product: ProductSummary;
  /** Outermost first: a gold is tagged yellow, then gold. */
  tags: readonly FacetBucket[];
  onSelectTag: (slug: string) => void;
}>;

export const ProductCard = ({ product, tags, onSelectTag }: ProductCardProps) => (
  <article className="group relative flex flex-col overflow-hidden rounded-[--radius-card] border border-line bg-surface transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg">
    <div className="relative">
      <Swatch
        hex={product.hex}
        image={product.primaryImage}
        alt={`${product.name} — ${product.hex}`}
        caption={product.hex}
        className="aspect-square w-full"
      />

      {/*
        Over the swatch rather than under the title: the card has to stay
        shorter than the filter rail beside it, and this is the one part of it
        with room to spare. Frosted rather than tinted, so legibility does not
        depend on the color underneath.
      */}
      <ul className="absolute bottom-2 left-2 z-10 flex flex-wrap gap-1">
        {tags.map((tag) => (
          <li key={tag.value}>
            <button
              type="button"
              onClick={() => onSelectTag(tag.value)}
              className="rounded-full bg-surface/75 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft backdrop-blur-sm hover:bg-surface hover:text-accent"
            >
              {tag.label}
            </button>
          </li>
        ))}
      </ul>
    </div>

    <div className="flex flex-1 flex-col gap-2 p-3">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[11px] font-medium uppercase tracking-wider text-ink-faint">
            {product.brand.name}
          </p>
          {/*
            The finish is a property of the color, so it belongs beside the
            foundry that made it. It used to share the price row with the stock
            note, which made "Gloss" and "Only 3 left" look like two answers to
            the same question.
          */}
          <span className="shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-faint">
            {product.finish}
          </span>
        </div>

        <h3 className="text-sm font-semibold leading-snug text-ink group-hover:text-accent">
          <Link
            to={`/color/${product.slug}`}
            className="after:absolute after:inset-0 after:content-['']"
          >
            {product.name}
          </Link>
        </h3>
      </div>

      <Stars rating={product.rating.average} count={product.rating.count} />

      <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
        <span className="text-base font-semibold tabular-nums text-ink">
          {price(product.priceCents)}
        </span>

        {/* Always a stock answer, never sometimes something else. */}
        {match(product.stockQuantity)
          .with(0, () => (
            <span className="text-xs font-medium text-danger">Out of stock</span>
          ))
          .with(P.number.lte(8), (remaining) => (
            <span className="text-xs font-medium text-warn">
              Only {remaining} left
            </span>
          ))
          .otherwise(() => <span className="text-xs text-ink-faint">In stock</span>)}
      </div>
    </div>
  </article>
);
