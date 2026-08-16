/**
 * Search with live suggestions.
 *
 * Debounced so a query does not leave for every keystroke, and driven by the
 * trigram index rather than full-text search — three letters into "screa…"
 * is not yet a word `to_tsquery` can match.
 */

import type { Suggestion } from "@prism/shared";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { match, P } from "ts-pattern";
import { api, toQueryString } from "../../../shared/api/client.ts";

const DEBOUNCE_MS = 160;
const MIN_TERM_LENGTH = 2;

export type SearchBoxProps = Readonly<{
  value: string;
  onSubmit: (term: string) => void;
}>;

export const SearchBox = ({ value, onSubmit }: SearchBoxProps) => {
  const [term, setTerm] = useState(value);
  const [suggestions, setSuggestions] = useState<readonly Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setTerm(value);
  }, [value]);

  useEffect(() => {
    if (term.trim().length < MIN_TERM_LENGTH) {
      setSuggestions([]);
      return undefined;
    }

    const controller = new AbortController();

    const timer = setTimeout(() => {
      void api
        .get<readonly Suggestion[]>(
          `/products/suggest${toQueryString({ q: term.trim(), limit: 8 })}`,
          controller.signal,
        )
        .then((found) => {
          setSuggestions(found);
          setHighlighted(-1);
        })
        .catch(() => setSuggestions([]));
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [term]);

  // Clicking anywhere else closes the list.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (
        containerRef.current !== null &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const choose = (suggestion: Suggestion): void => {
    setOpen(false);

    match(suggestion.kind)
      .with("product", () => void navigate(`/item/${suggestion.slug}`))
      .with("category", () => void navigate(`/?tag=${suggestion.slug}`))
      .with("brand", () => void navigate(`/?brands=${suggestion.slug}`))
      .exhaustive();
  };

  return (
    <div ref={containerRef} className="relative flex-1">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setOpen(false);
          onSubmit(term.trim());
        }}
      >
        <label htmlFor="catalog-search" className="sr-only">
          Search colors
        </label>

        <div className="relative">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="M14 14l4 4" strokeLinecap="round" />
          </svg>

          <input
            id="catalog-search"
            type="search"
            value={term}
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls="search-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="Search colors, tools, foundries, tags…"
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(event) => {
              match(event.key)
                .with("ArrowDown", () => {
                  event.preventDefault();
                  setHighlighted((current) =>
                    Math.min(current + 1, suggestions.length - 1),
                  );
                })
                .with("ArrowUp", () => {
                  event.preventDefault();
                  setHighlighted((current) => Math.max(current - 1, -1));
                })
                .with("Escape", () => setOpen(false))
                .with("Enter", () => {
                  const chosen = suggestions[highlighted];
                  if (chosen !== undefined) {
                    event.preventDefault();
                    choose(chosen);
                  }
                })
                .otherwise(() => undefined);
            }}
            className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong"
          />
        </div>
      </form>

      {match({ open, count: suggestions.length })
        .with({ open: true, count: P.number.gt(0) }, () => (
          <ul
            id="search-suggestions"
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-xl"
          >
            {suggestions.map((suggestion, index) => (
              <li key={`${suggestion.kind}-${suggestion.slug}`} role="option" aria-selected={index === highlighted}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={() => choose(suggestion)}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm ${
                    index === highlighted ? "bg-sunken" : ""
                  }`}
                >
                  {match(suggestion.hex)
                    .with({ _tag: "Some" }, ({ value }) => (
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded border border-line"
                        style={{ backgroundColor: value }}
                      />
                    ))
                    .with({ _tag: "None" }, () => (
                      <span className="size-4 shrink-0" aria-hidden="true" />
                    ))
                    .exhaustive()}

                  <span className="flex-1 truncate text-ink">{suggestion.label}</span>

                  <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                    {suggestion.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))
        .otherwise(() => null)}
    </div>
  );
};
