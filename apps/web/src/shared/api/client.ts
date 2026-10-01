/**
 * The HTTP client.
 *
 * Every non-2xx response is decoded into the `ErrorResponse` the server
 * produced, so the UI reads a code and a sentence rather than parsing prose.
 * A 401 triggers exactly one refresh attempt, and concurrent 401s share it:
 * rotation is single-use, so several refreshes at once would look like a
 * replay and revoke the session.
 */

import type { AccessGrant, ErrorResponse } from "@prism/shared";
import { TokenStore } from "../../features/auth/token-store.ts";

/** A request the API refused, as something `throw` accepts. */
export class ApiError extends Error {
  readonly status: number;
  readonly failure: ErrorResponse["error"];

  constructor(status: number, failure: ErrorResponse["error"]) {
    super(failure.message);
    this.name = "ApiError";
    this.status = status;
    this.failure = failure;
  }
}

/** What a request may carry beyond its path. */
export type RequestOptions = Readonly<{
  method?: string;
  body?: unknown;
  /** False for endpoints where a 401 is the answer, like sign-in. */
  retryOnUnauthorized?: boolean;
  signal?: AbortSignal;
}>;

/** The one refresh in flight, shared by every 401 that arrives while it runs. */
const Refresh: { inFlight: Promise<boolean> | undefined } = { inFlight: undefined };

/** The response body of a refusal, when the server produced one. */
const isErrorResponse = (payload: unknown): payload is ErrorResponse =>
  typeof payload === "object" &&
  payload !== null &&
  "error" in payload &&
  typeof payload.error === "object" &&
  payload.error !== null &&
  "code" in payload.error &&
  typeof payload.error.code === "string" &&
  "message" in payload.error &&
  typeof payload.error.message === "string" &&
  "issues" in payload.error &&
  Array.isArray(payload.error.issues);

export const Api = {
  BASE: "/api/v1",

  /** What a refusal without a readable body is reported as. */
  UNREADABLE: {
    code: "InternalError",
    message: "Something went wrong at our end.",
    issues: [],
  } satisfies ErrorResponse["error"],

  /** Sends one request with the bearer token, if any. */
  send: async (path: string, options: RequestOptions): Promise<Response> => {
    const token = TokenStore.get();
    const headers: Record<string, string> = {};

    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (token !== undefined) headers["authorization"] = `Bearer ${token}`;

    return fetch(`${Api.BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      // The refresh and cart cookies are same-origin; Caddy puts the API behind /api.
      credentials: "same-origin",
      body: options.body === undefined ? null : JSON.stringify(options.body),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  },

  /**
   * Trades the refresh cookie for a fresh access token. Concurrent callers
   * share one attempt.
   */
  refresh: (): Promise<boolean> => {
    if (Refresh.inFlight !== undefined) return Refresh.inFlight;

    const attempt = fetch(`${Api.BASE}/auth/refresh`, { method: "POST", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) {
          TokenStore.clear();
          return false;
        }

        const grant: AccessGrant = await response.json();
        TokenStore.set(grant.accessToken, grant.user);
        return true;
      })
      .finally(() => {
        Refresh.inFlight = undefined;
      });

    Refresh.inFlight = attempt;
    return attempt;
  },

  /** Sends, retries once on 401, and throws an `ApiError` on any refusal. */
  exchange: async (path: string, options: RequestOptions): Promise<Response> => {
    let response = await Api.send(path, options);

    if (response.status === 401 && options.retryOnUnauthorized !== false) {
      const refreshed = await Api.refresh();
      if (refreshed) response = await Api.send(path, options);
    }

    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new ApiError(response.status, isErrorResponse(payload) ? payload.error : Api.UNREADABLE);
    }

    return response;
  },

  /** A request whose body is decoded as JSON. */
  request: async <A>(path: string, options: RequestOptions = {}): Promise<A> => {
    const response = await Api.exchange(path, options);
    return response.json();
  },

  /** A request whose 204 has no body to decode. */
  requestEmpty: async (path: string, options: RequestOptions = {}): Promise<void> => {
    await Api.exchange(path, options);
  },

  get: <A>(path: string, signal?: AbortSignal): Promise<A> =>
    Api.request<A>(path, signal === undefined ? {} : { signal }),

  post: <A>(path: string, body?: unknown): Promise<A> => Api.request<A>(path, { method: "POST", body }),

  put: <A>(path: string, body?: unknown): Promise<A> => Api.request<A>(path, { method: "PUT", body }),

  delete: <A>(path: string): Promise<A> => Api.request<A>(path, { method: "DELETE" }),

  postEmpty: (path: string, body?: unknown): Promise<void> =>
    Api.requestEmpty(path, { method: "POST", body }),

  /** For sign-in and registration, where a 401 is the answer, not a hint to retry. */
  postWithoutRetry: <A>(path: string, body?: unknown): Promise<A> =>
    Api.request<A>(path, { method: "POST", body, retryOnUnauthorized: false }),

  postEmptyWithoutRetry: (path: string, body?: unknown): Promise<void> =>
    Api.requestEmpty(path, { method: "POST", body, retryOnUnauthorized: false }),

  /** The failure inside a caught value, or `undefined` if it did not come from the API. */
  failureOf: (reason: unknown): ErrorResponse["error"] | undefined =>
    reason instanceof ApiError ? reason.failure : undefined,
} as const;
