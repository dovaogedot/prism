/**
 * One product in the grid, whichever of the three it is.
 *
 * The title's link stretches over the whole card with a pseudo-element, so the
 * card behaves like one click target whichever part of it is clicked.
 *
 * Everything on it has to earn its height: the grid of these must stay shorter
 * than the filter rail beside it, or filtering changes the page height and
 * takes the scroll position with it.
 */

import { formatPrice, isCents, type ProductSummary } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Stars } from "../../../shared/ui/index.ts";
import { Artwork } from "./Artwork.tsx";

const price = (cents: number): string =>
  isCents(cents) ? formatPrice(cents) : "—";

/**
 * Shared with the empty slot below, so the two cannot drift apart. A page
 * holds `perPage` slots whether or not there is stock to fill them, and a slot
 * only holds the page's height still if it is exactly a card's height.
 */
const SHELL =
  "relative flex flex-col overflow-hidden rounded-[--radius-card] border border-line bg-surface";
const BODY = "flex flex-1 flex-col gap-2 p-3";
const BRAND = "truncate text-[11px] font-medium uppercase tracking-wider text-ink-faint";
/**
 * Two lines, always. Names run from "Bone" to "Union-approved Applicator", and
 * a title free to be one line or two would make a row of cards a different
 * height depending on which products landed in it.
 */
const TITLE = "line-clamp-2 min-h-10 text-sm font-semibold leading-snug";

/** One product, as the grid shows it. */
export type ProductCardProps = Readonly<{ product: ProductSummary }>;

/** A product in the grid: its picture, its name, its foundry, its rating, its price. */
export const ProductCard = ({ product }: ProductCardProps) => (
  <article
    className={`group ${SHELL} transition-all duration-200 hover:border-line-strong hover:shadow-lg`}
  >
    <div className="relative">
      {/*
        The artwork is its own link rather than a region of the title's.

        The title's stretched pseudo-element covers the whole card, artwork
        included, which makes it the thing under the pointer there — and a
        color's stage has to feel the pointer to turn toward it. Lifting the
        artwork above that overlay would have cost the click, so it gets a link
        of its own to the same place: out of the tab order and out of the
        accessibility tree, because the title below already says all of this.
      */}
      <Link
        to={`/item/${product.slug}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative z-10 block"
      >
        <Artwork
          spec={product.spec}
          name={product.name}
          image={product.primaryImage}
          captioned
          className="aspect-square w-full"
        />
      </Link>
    </div>

    <div className={BODY}>
      <div className="space-y-0.5">
        <p className={BRAND}>{product.brand.name}</p>

        <h3 className={`${TITLE} text-ink group-hover:text-accent`}>
          <Link
            to={`/item/${product.slug}`}
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

/**
 * An empty slot, exactly a card tall.
 *
 * The grid holds a full page of slots however few results there are. Without
 * that the grid shrinks as filters narrow, the document height goes with it,
 * and the scroll position moves under the pointer. The filter rail cannot
 * absorb that, because its own height depends on which category is selected.
 *
 * It is built from the same constants as the card above rather than from a
 * measured pixel height, so a change to the card's padding moves both.
 */
export const ProductCardSlot = () => (
  <div aria-hidden="true" className={`${SHELL} invisible`}>
    <div className="aspect-square w-full" />
    <div className={BODY}>
      <div className="space-y-0.5">
        <p className={BRAND}>&nbsp;</p>
        <h3 className={TITLE}>&nbsp;</h3>
      </div>
      <Stars rating={0} count={0} />
      <div className="mt-auto flex items-baseline justify-between gap-2 pt-1">
        <span className="text-base font-semibold">&nbsp;</span>
        <span className="text-xs">&nbsp;</span>
      </div>
    </div>
  </div>
);
