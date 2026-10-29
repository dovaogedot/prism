import { OrderSort, OrderStatus } from "@prism/shared";
import { useSearchParams } from "react-router";
import { DateFilter, useDateFilter } from "../../../shared/hooks/use-date-filter.ts";
import { OrderParams } from "../orders.ts";
import { UrlParams } from "../../../shared/url/url-params.ts";

/**
 * The list's filters: a chip per status, any number of them at once, a date
 * range whose ends both count, and the sort. Every change is a new URL.
 */
export const OrderFilters = () => {
  const [params, setParams] = useSearchParams();

  /** Filters or sorts in place, so the page keeps its scroll. */
  const filter = (next: URLSearchParams): void => {
    setParams(next, { preventScrollReset: true });
  };

  const from = useDateFilter(params.get("from") ?? "", (date) => filter(UrlParams.set(params, "from", date)), { max: DateFilter.boundOf(params.get("to")) });

  const to = useDateFilter(params.get("to") ?? "", (date) => filter(UrlParams.set(params, "to", date)), { min: DateFilter.boundOf(params.get("from")) });

  const chosen = OrderParams.statuses(params);
  const sort = OrderSort.schema.catch("newest").parse(params.get("sort") ?? "newest");

  const dateInput =
    "rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink hover:border-line-strong";

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {OrderStatus.NAMES.map((status) => {
          const on = chosen.includes(status);

          return (
            <button
              key={status}
              type="button"
              aria-pressed={on}
              onClick={() => filter(UrlParams.toggle(params, "status", status))}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-soft hover:border-line-strong hover:text-ink"
              }`}
            >
              {OrderStatus.label[status]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm text-ink-soft">
          <span className="block">From</span>
          <input className={dateInput} type="date" {...from} />
        </label>
        <label className="space-y-1 text-sm text-ink-soft">
          <span className="block">To</span>
          <input className={dateInput} type="date" {...to} />
        </label>
        <label className="space-y-1 text-sm text-ink-soft">
          <span className="block">Sort</span>
          <select
            value={sort}
            onChange={(event) => filter(UrlParams.set(params, "sort", event.target.value))}
            className={dateInput}
          >
            {OrderSort.NAMES.map((option) => (
              <option key={option} value={option}>
                {OrderSort.label[option]}
              </option>
            ))}
          </select>
        </label>

        {OrderParams.isFiltered(params) ? (
          <button
            type="button"
            onClick={() => {
              const next = new URLSearchParams();
              if (params.has("sort")) next.set("sort", sort);
              filter(next);
            }}
            className="py-2 text-sm font-medium text-accent hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    </div>
  );
};
