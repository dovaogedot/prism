import { useId } from "react";
import { Link } from "react-router";
import { Popover } from "../../../shared/ui/index.ts";
import { useCategories } from "../catalog.ts";

/** The header's way into the shop: the whole catalog, and each category with how many items it holds. */
export const CategoryMenu = () => {
  const categories = useCategories();

  const panelId = useId();

  const linkClass = "flex items-center justify-between gap-4 rounded-md px-3 py-2 text-sm text-ink hover:bg-sunken";

  return (
    <>
      <button
        className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink"
        type="button"
        popoverTarget={panelId}
      >
        Shop
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Popover id={panelId} side="start" label="Shop by category">
        <ul className="p-2">
          <li>
            <Link className={`${linkClass} font-semibold`} to="/shop">
              All products
            </Link>
          </li>
          {(categories.data ?? []).map((category) => (
            <li key={category.slug}>
              <Link className={linkClass} to={`/categories/${category.slug}`}>
                {category.name}
                <span className="text-xs tabular-nums text-ink-faint">{category.productCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Popover>
    </>
  );
};
