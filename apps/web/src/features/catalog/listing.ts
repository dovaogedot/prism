/**
 * The listing's state as its URL carries it. `/shop`, `/categories/:slug`
 * and `/search` share one listing. The page's query string is the query of
 * `GET /products`, except `view`, which only the page reads; a category page
 * takes its category from the path instead of the query.
 */

/** How the results are drawn. */
export type ListingView = "grid" | "list";

/** Which of the three addresses the listing is drawn for. */
export type ListingKind = "shop" | "category" | "search";

export const Listing = {
  /** How the results are drawn: as a grid unless the URL asks for the list. */
  view: (params: URLSearchParams): ListingView => (params.get("view") === "list" ? "list" : "grid"),

  /** `params` drawn as `view`. The grid is the default, so it leaves the key out. */
  withView: (params: URLSearchParams, view: ListingView): URLSearchParams => {
    const next = new URLSearchParams(params);

    if (view === "list") {
      next.set("view", "list");
    } else {
      next.delete("view");
    }

    return next;
  },

  /** The query string `GET /products` gets for the page: its own query without `view`, with the path's category. */
  apiQuery: (params: URLSearchParams, category: string | undefined): string => {
    const query = new URLSearchParams(params);
    query.delete("view");

    if (category !== undefined) {
      query.set("category", category);
    }

    return query.toString();
  },

  /**
   * Where `/shop?category=x` belongs: `/categories/x`, with the rest of the
   * query but from its first page. `undefined` when no category is chosen.
   */
  categoryRedirect: (params: URLSearchParams): string | undefined => {
    const category = params.get("category");
    if (category === null || category.length === 0) return undefined;

    const rest = new URLSearchParams(params);
    rest.delete("category");
    rest.delete("page");
    const query = rest.toString();

    return `/categories/${encodeURIComponent(category)}${query.length === 0 ? "" : `?${query}`}`;
  },
} as const;
