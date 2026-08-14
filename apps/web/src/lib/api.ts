/**
 * The HTTP client.
 *
 * Two things make it more than a `fetch` wrapper:
 *
 * 1. Every non-2xx response is decoded into the same `DomainError` the server
 *    produced, so the UI matches on a tag rather than parsing prose.
 * 2. A 401 triggers exactly one refresh attempt, and concurrent 401s share it.
 *    Without the sharing, a page that fires five queries at once would rotate
 *    the refresh token five times — and since rotation is single-use, four of
 *    those would look like a replay and revoke the session.
 */

import {
  httpStatusByTag,
  Option,
  TAGLESS_ERRORS,
  type AccessGrant,
  type DomainError,
  type TaglessDomainErrorTag,
  type ValidationIssue,
} from "@hue/shared";
import { tokenStore } from "./token-store.ts";

const BASE = "/api/v1";

export type ApiFailure = Readonly<{
  error: DomainError;
  status: number;
}>;

export class ApiError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.error._tag);
    this.name = "ApiError";
    this.failure = failure;
  }
}

const isErrorEnvelope = (
  payload: unknown,
): payload is Readonly<{
  error: { code: string; message: string; issues?: readonly ValidationIssue[] };
}> =>
  typeof payload === "object" &&
  payload !== null &&
  "error" in payload &&
  typeof payload.error === "object" &&
  payload.error !== null &&
  "code" in payload.error &&
  typeof payload.error.code === "string";

/**
 * `ValidationFailed` is the one variant carrying data, so it is excluded here
 * and handled separately. Every remaining variant is `{ _tag }` alone, which
 * is what lets `{ _tag: code }` typecheck against the union without a cast.
 *
 * The status table's keys are precisely the set of valid tags, so it doubles
 * as the runtime guard — an unrecognised code from a newer server degrades to
 * a generic failure rather than a bogus tag.
 */
const isTaglessErrorTag = (code: string): code is TaglessDomainErrorTag =>
  code !== "ValidationFailed" && Object.hasOwn(httpStatusByTag, code);

const toDomainError = (payload: unknown): DomainError => {
  if (!isErrorEnvelope(payload)) return { _tag: "Conflict" };

  const code = payload.error.code;

  // ValidationFailed is the one variant carrying data, so it is rebuilt
  // rather than just re-tagged.
  if (code === "ValidationFailed") {
    return { _tag: "ValidationFailed", issues: payload.error.issues ?? [] };
  }

  return isTaglessErrorTag(code) ? TAGLESS_ERRORS[code] : TAGLESS_ERRORS.Conflict;
};

/** In flight while a refresh is happening; every 401 waits on this one promise. */
let refreshInFlight: Option<Promise<boolean>> = Option.none;

const performRefresh = async (): Promise<boolean> => {
  const response = await fetch(`${BASE}/auth/refresh`, {
    method: "POST",
    credentials: "same-origin",
  });

  if (!response.ok) {
    tokenStore.clear();
    return false;
  }

  const grant: AccessGrant = await response.json();
  tokenStore.set(grant.accessToken, grant.user);
  return true;
};

export const refreshSession = (): Promise<boolean> => {
  if (Option.isSome(refreshInFlight)) return refreshInFlight.value;

  const attempt = performRefresh().finally(() => {
    refreshInFlight = Option.none;
  });

  refreshInFlight = Option.some(attempt);
  return attempt;
};

type RequestOptions = Readonly<{
  method?: string;
  body?: unknown;
  /** Set for endpoints that must not silently retry, like sign-in. */
  retryOnUnauthorised?: boolean;
  signal?: AbortSignal;
}>;

const send = async (path: string, options: RequestOptions): Promise<Response> => {
  const token = tokenStore.get();

  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (Option.isSome(token)) headers["authorization"] = `Bearer ${token.value}`;

  return fetch(`${BASE}${path}`, {
    method: options.method ?? "GET",
    headers,
    // The refresh cookie is same-origin; Caddy puts the API behind /api.
    credentials: "same-origin",
    body: options.body === undefined ? null : JSON.stringify(options.body),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
};

/** Sends, retries once on 401, and throws an `ApiError` on any other failure. */
const exchange = async (
  path: string,
  options: RequestOptions,
): Promise<Response> => {
  let response = await send(path, options);

  if (response.status === 401 && options.retryOnUnauthorised !== false) {
    const refreshed = await refreshSession();
    if (refreshed) response = await send(path, options);
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ApiError({ error: toDomainError(payload), status: response.status });
  }

  return response;
};

export const request = async <A>(
  path: string,
  options: RequestOptions = {},
): Promise<A> => {
  const response = await exchange(path, options);
  return response.json();
};

/**
 * Separate from `request` because a 204 has no body to decode. Folding both
 * into one function would mean claiming to return an `A` that does not exist.
 */
export const requestEmpty = async (
  path: string,
  options: RequestOptions = {},
): Promise<void> => {
  await exchange(path, options);
};

export const api = {
  get: <A>(path: string, signal?: AbortSignal): Promise<A> =>
    request<A>(path, signal === undefined ? {} : { signal }),

  post: <A>(path: string, body?: unknown): Promise<A> =>
    request<A>(path, { method: "POST", body }),

  postEmpty: (path: string, body?: unknown): Promise<void> =>
    requestEmpty(path, { method: "POST", body }),

  /** For sign-in and registration, where a 401 is the answer, not a hint to retry. */
  postWithoutRetry: <A>(path: string, body?: unknown): Promise<A> =>
    request<A>(path, { method: "POST", body, retryOnUnauthorised: false }),

  postEmptyWithoutRetry: (path: string, body?: unknown): Promise<void> =>
    requestEmpty(path, { method: "POST", body, retryOnUnauthorised: false }),
} as const;

export const toApiFailure = (reason: unknown): Option<ApiFailure> =>
  reason instanceof ApiError ? Option.some(reason.failure) : Option.none;

/**
 * Builds a query string from the catalogue filter state, omitting anything
 * empty so the URL stays legible and the server's cache key stays stable.
 */
export const toQueryString = (
  params: Readonly<Record<string, string | number | readonly string[]>>,
): string => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    const encoded = Array.isArray(value) ? value.join(",") : String(value);
    if (encoded.length > 0) search.set(key, encoded);
  }

  const query = search.toString();
  return query.length === 0 ? "" : `?${query}`;
};
