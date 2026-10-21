import type { CategorySummary } from "@prism/shared";
import { Link } from "react-router";
import { Picture } from "../../catalog/components/Picture.tsx";

/** The category the tile leads to. */
export type CategoryTileProps = Readonly<{ category: CategorySummary }>;

/** A category as a picture card, with how many items it holds. The whole tile is the link. */
export const CategoryTile = ({ category }: CategoryTileProps) => (
  <Link
    className="group flex items-center gap-4 rounded-lg border border-line bg-surface p-3 transition-all hover:border-line-strong hover:shadow-md"
    to={`/categories/${category.slug}`}
  >
    <Picture className="size-16 shrink-0 rounded-md" image={category.image} name={category.name} sizes="4rem" isDecorative />
    <span className="min-w-0">
      <span className="block truncate font-semibold text-ink group-hover:text-accent">{category.name}</span>
      <span className="block text-sm tabular-nums text-ink-soft">{category.productCount === 1 ? "1 item" : `${category.productCount} items`}</span>
    </span>
  </Link>
);
