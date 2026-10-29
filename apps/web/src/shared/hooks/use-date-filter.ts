import { useEffect, useState, type ChangeEvent } from "react";

/**
 * The dates a date filter may take, inclusive; either end left out is open.
 * `| undefined` is explicit, since a bound comes from a URL that may lack it.
 */
export type DateBounds = Readonly<{ min?: string | undefined; max?: string | undefined }>;

export const DateFilter = {
  /**
   * Whether a date input's value is ready to filter by: empty, which clears
   * the filter, or a whole date inside `bounds`. A year still being typed,
   * such as 0202 on the way to 2026, is not.
   */
  isCommittable: (typed: string, bounds: DateBounds): boolean => {
    if (typed === "") return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(typed) || Number(typed.slice(0, 4)) < 1000) return false;

    return (bounds.min === undefined || typed >= bounds.min) && (bounds.max === undefined || typed <= bounds.max);
  },

  /** A URL's date as a bound: absent when the URL has none. */
  boundOf: (value: string | null): string | undefined => (value === null || value === "" ? undefined : value),
} as const;

/**
 * The props of a date input that filters a list by `committed`. It shows
 * what is typed and hands `commit` only a date `DateFilter.isCommittable`
 * accepts, so typing a year sends one change, not four.
 */
export const useDateFilter = (committed: string, commit: (date: string) => void, bounds: DateBounds) => {
  const [draft, setDraft] = useState(committed);

  // The URL changed from elsewhere: Back, or a cleared filter.
  useEffect(() => {
    setDraft(committed);
  }, [committed]);

  return {
    value: draft,
    ...(bounds.min === undefined ? {} : { min: bounds.min }),
    ...(bounds.max === undefined ? {} : { max: bounds.max }),
    onChange: (event: ChangeEvent<HTMLInputElement>): void => {
      setDraft(event.target.value);
      if (DateFilter.isCommittable(event.target.value, bounds)) {
        commit(event.target.value);
      }
    },
  };
};
