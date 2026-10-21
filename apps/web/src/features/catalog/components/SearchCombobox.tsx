import { Price, type Suggestion } from "@prism/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useDebounced } from "../../../shared/hooks/use-debounced.ts";
import { ImageSet } from "../../../shared/ui/index.ts";
import { Combobox, type ComboboxState } from "../combobox.ts";

/** One entry of the list: a product to open, or the search for what is typed. */
type SearchOption = Readonly<{ kind: "product"; product: Suggestion }> | Readonly<{ kind: "search"; text: string }>;

/**
 * The header's search box, on every page. From two typed characters it
 * lists matching products with a picture and a price, and last a search for
 * the text itself. The arrows move through the list, Enter opens what is
 * active or searches, and Escape closes the list. A slash anywhere outside a
 * text field jumps to the box.
 */
export const SearchCombobox = () => {
  const navigate = useNavigate();

  const { pathname } = useLocation();

  const [params] = useSearchParams();

  const [text, setText] = useState("");

  const [state, setState] = useState<ComboboxState>(Combobox.CLOSED);

  const input = useRef<HTMLInputElement>(null);

  const listboxId = useId();

  const typed = useDebounced(text.trim(), 150);

  const suggestions = useQuery({
    queryKey: ["suggest", typed],
    queryFn: ({ signal }) => Api.get<{ items: readonly Suggestion[] }>(`/products/suggest?q=${encodeURIComponent(typed)}&limit=6`, signal),
    enabled: typed.length >= 2,
    placeholderData: keepPreviousData,
  });

  // The search results page keeps its query in the box.
  const query = pathname === "/search" ? (params.get("q") ?? "") : undefined;

  useEffect(() => {
    if (query !== undefined) {
      setText(query);
    }
  }, [query]);

  useEffect(() => {
    const jump = (event: KeyboardEvent): void => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || Combobox.isTyping(event.target)) return;

      event.preventDefault();
      input.current?.focus();
    };

    document.addEventListener("keydown", jump);
    return () => document.removeEventListener("keydown", jump);
  }, []);

  const trimmed = text.trim();
  const products = trimmed.length >= 2 ? (suggestions.data?.items ?? []) : [];
  const options: readonly SearchOption[] =
    trimmed.length >= 2 ? [...products.map((product) => ({ kind: "product" as const, product })), { kind: "search", text: trimmed }] : [];
  const shown = Combobox.clamp(state, options.length);
  const isExpanded = shown.isOpen && options.length > 0;
  const optionId = (index: number) => `${listboxId}-${index}`;

  const choose = (option: SearchOption | undefined): void => {
    setState(Combobox.CLOSED);

    if (option?.kind === "product") {
      setText("");
      input.current?.blur();
      void navigate(`/products/${option.product.slug}`);
      return;
    }

    const searched = option?.text ?? trimmed;
    if (searched.length === 0) return;

    input.current?.blur();
    void navigate(`/search?q=${encodeURIComponent(searched)}`);
  };

  return (
    <form
      className="relative w-full"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        choose(undefined);
      }}
    >
      <label className="sr-only" htmlFor={`${listboxId}-input`}>
        Search products
      </label>
      <svg
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        className="h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-9 text-sm text-ink placeholder:text-ink-faint hover:border-line-strong"
        ref={input}
        id={`${listboxId}-input`}
        type="text"
        role="combobox"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search products"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={isExpanded}
        aria-activedescendant={isExpanded && shown.active !== undefined ? optionId(shown.active) : undefined}
        aria-keyshortcuts="/"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setState(Combobox.OPEN);
        }}
        onFocus={() => setState(Combobox.OPEN)}
        onBlur={() => setState(Combobox.CLOSED)}
        onKeyDown={(event) => {
          const step = Combobox.key(shown, event.key, options.length);
          if (step.isHandled) {
            event.preventDefault();
          }

          setState(step.state);

          if (step.action.kind === "choose") {
            choose(options[step.action.index]);
          }
          if (step.action.kind === "submit") {
            choose(undefined);
          }
          if (step.action.kind === "clear") {
            setText("");
          }
        }}
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 font-mono text-xs text-ink-faint sm:block" aria-hidden="true">
        /
      </kbd>

      <ul
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-[min(28rem,70dvh)] overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-xl"
        id={listboxId}
        role="listbox"
        aria-label="Suggestions"
        hidden={!isExpanded}
      >
        {options.map((option, index) => (
          <li
            className={`flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm ${index === shown.active ? "bg-accent-wash" : "hover:bg-sunken"}`}
            key={option.kind === "product" ? option.product.slug : "search"}
            id={optionId(index)}
            role="option"
            aria-selected={index === shown.active}
            // Keeps focus in the box, so the click lands before the list closes on blur.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(option)}
          >
            {match(option)
              .with({ kind: "product" }, ({ product }) => (
                <>
                  {product.image === undefined ? (
                    <span className="size-10 shrink-0 rounded bg-sunken" aria-hidden="true" />
                  ) : (
                    <ImageSet className="size-10 shrink-0 rounded bg-sunken object-contain" image={product.image} sizes="2.5rem" isDecorative />
                  )}
                  <span className="min-w-0 flex-1 truncate text-ink">{product.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-soft">{Price.format(product.priceCents)}</span>
                </>
              ))
              .with({ kind: "search" }, (search) => (
                <span className="px-1 py-1.5 text-ink-soft">
                  Search for <span className="font-medium text-ink">"{search.text}"</span>
                </span>
              ))
              .exhaustive()}
          </li>
        ))}
      </ul>
    </form>
  );
};
