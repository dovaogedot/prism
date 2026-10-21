import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Button } from "../../../shared/ui/index.ts";

/** What the page could not find, as its heading says it. */
export type NotFoundPageProps = Readonly<{ heading?: string }>;

/**
 * The page for an address nothing answers, and for a product or category
 * that does not exist. Search engines are told not to keep it; the web
 * server sends it with status 404 for an address outside the route list.
 */
export const NotFoundPage = ({ heading = "Page not found" }: NotFoundPageProps) => {
  const navigate = useNavigate();

  const [text, setText] = useState("");

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
      <PageMeta title={PageText.notFound.title} description={PageText.notFound.description} isIndexed={false} />
      <p className="text-sm font-semibold uppercase tracking-wider text-accent">404</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{heading}</h1>
      <p className="mt-3 text-ink-soft">It may have moved, or the link may be mistyped. Search for what you were after, or start again from the home page.</p>

      <form
        className="mx-auto mt-8 flex max-w-md gap-2"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          const query = text.trim();
          if (query.length === 0) return;

          void navigate(`/search?q=${encodeURIComponent(query)}`);
        }}
      >
        <label className="sr-only" htmlFor="not-found-search">
          Search products
        </label>
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong"
          id="not-found-search"
          type="search"
          placeholder="Search products"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>

      <p className="mt-8 text-sm">
        <Link className="font-medium text-accent underline underline-offset-2" to="/">
          Go to the home page
        </Link>
      </p>
    </div>
  );
};
