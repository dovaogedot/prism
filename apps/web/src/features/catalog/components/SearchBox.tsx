import type { Suggestion } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Api } from "../../../shared/api/client.ts";

/** The text as the URL has it, and where a submitted search goes. */
export type SearchBoxProps = Readonly<{ value: string; onSubmit: (text: string) => void }>;

/**
 * The search field. Product names that match what is typed so far are offered
 * through the browser's own `<datalist>` menu.
 */
export const SearchBox = ({ value, onSubmit }: SearchBoxProps) => {
  const [text, setText] = useState(value);
  const typed = text.trim();

  const suggestions = useQuery({
    queryKey: ["suggest", typed],
    queryFn: ({ signal }) =>
      Api.get<{ items: readonly Suggestion[] }>(`/products/suggest?q=${encodeURIComponent(typed)}`, signal),
    enabled: typed.length > 0,
  });

  return (
    <form
      role="search"
      className="flex flex-1 gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(typed);
      }}
    >
      <input
        type="search"
        name="q"
        list="product-suggestions"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search products"
        aria-label="Search products"
        autoComplete="off"
        className="h-[2.625rem] w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong"
      />
      <datalist id="product-suggestions">
        {(suggestions.data?.items ?? []).map((item) => (
          <option key={item.slug} value={item.name} />
        ))}
      </datalist>
      <button
        type="submit"
        className="h-[2.625rem] rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
      >
        Search
      </button>
    </form>
  );
};
