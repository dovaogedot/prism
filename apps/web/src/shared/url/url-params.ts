/** A list's state as its URL holds it: values set and toggled, back to page one on any change but the page. */
export const UrlParams = {
  /**
   * `params` with `key` set to `value`, or without `key` when `value` is
   * empty. Any change but the page itself starts again from page one.
   */
  set: (params: URLSearchParams, key: string, value: string): URLSearchParams => {
    const next = new URLSearchParams(params);

    if (value.length === 0) next.delete(key);
    else next.set(key, value);

    if (key !== "page") next.delete("page");

    return next;
  },

  /** `params` with `value` added to the repeatable `key` if absent, or removed if present. */
  toggle: (params: URLSearchParams, key: string, value: string): URLSearchParams => {
    const next = new URLSearchParams(params);
    const values = next.getAll(key);

    next.delete(key);
    for (const current of values) if (current !== value) next.append(key, current);
    if (!values.includes(value)) next.append(key, value);
    next.delete("page");

    return next;
  },
} as const;
