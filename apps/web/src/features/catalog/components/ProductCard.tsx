/**
 * One product in the grid, whichever of the three it is.
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

import {
  DIRECTION_SYMBOLS,
  formatPrice,
  isCents,
  type FacetBucket,
  type ProductSummary,
} from "@prism/shared";
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
const BADGE =
  "shrink-0 rounded-full border border-line px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-ink-faint";
/**
 * Two lines, always. Names run from "Bone" to "Union-approved Applicator", and
 * a title free to be one line or two would make a row of cards a different
 * height depending on which products landed in it.
 */
const TITLE = "line-clamp-2 min-h-10 text-sm font-semibold leading-snug";

export type ProductCardProps = Readonly<{
  product: ProductSummary;
  /** Outermost first: a gold is tagged yellow, then gold. */
  tags: readonly FacetBucket[];
  onSelectTag: (slug: string) => void;
}>;

export const ProductCard = ({ product, tags, onSelectTag }: ProductCardProps) => (
  <article
    className={`group ${SHELL} transition-all duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lg`}
  >
    <div className="relative">
      <Artwork
        spec={product.spec}
        name={product.name}
        image={product.primaryImage}
        captioned
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

    <div className={BODY}>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className={BRAND}>{product.brand.name}</p>
          {/*
            The one number that says what this particular thing is: a color's
            finish, a finisher's reach, a shifter's turn. It belongs beside the
            foundry that made it — it used to share the price row with the stock
            note, which made "Gloss" and "Only 3 left" look like two answers to
            the same question.
          */}
          <span className={BADGE}>
            {match(product.spec)
              .with({ kind: "color" }, ({ finish }) => finish)
              .with({ kind: "finisher" }, ({ durability }) => `${durability} colors`)
              .with({ kind: "shifter" }, ({ direction, arcDegrees }) =>
                `${DIRECTION_SYMBOLS[direction]} ${arcDegrees}°`,
              )
              .exhaustive()}
          </span>
        </div>

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
 * and the scroll position moves under the pointer — which the filter rail used
 * to absorb, back when it was always the taller of the two columns. It is not,
 * now that its height depends on which category is selected.
 *
 * It is built from the same constants as the card above rather than from a
 * measured pixel height, so a change to the card's padding moves both.
 */
export const ProductCardSlot = () => (
  <div aria-hidden="true" className={`${SHELL} invisible`}>
    <div className="aspect-square w-full" />
    <div className={BODY}>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <p className={BRAND}>&nbsp;</p>
          <span className={BADGE}>&nbsp;</span>
        </div>
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
