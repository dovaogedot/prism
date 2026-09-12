/**
 * The access token lives here and nowhere else.
 *
 * A module-level variable, deliberately. It is never written to localStorage
 * or sessionStorage, so there is nothing for an injected script to read and
 * nothing that survives the tab closing. What survives a reload is the
 * httpOnly refresh cookie, which script cannot touch either; the app trades
 * it for a fresh access token on boot.
 */

import type { SessionUser } from "@prism/shared";

/** The token and the person it was granted to. */
export type Held = Readonly<{ token: string; user: SessionUser }>;

/** The one held grant and who wants to know when it changes. */
const TokenState: { held: Held | undefined; readonly listeners: Set<() => void> } = {
  held: undefined,
  listeners: new Set(),
};

/**
 * The access token and its user, held for the life of the tab.
 *
 * `subscribe` and `snapshot` are shaped for `useSyncExternalStore`, so React
 * reads this store rather than a copy of it.
 */
export const TokenStore = {
  get: (): string | undefined => TokenState.held?.token,

  user: (): SessionUser | undefined => TokenState.held?.user,

  set: (token: string, user: SessionUser): void => {
    TokenState.held = { token, user };
    TokenStore.announce();
  },

  /** Replaces the cached user without disturbing a valid token. */
  updateUser: (user: SessionUser): void => {
    if (TokenState.held !== undefined) TokenState.held = { token: TokenState.held.token, user };
    TokenStore.announce();
  },

  clear: (): void => {
    TokenState.held = undefined;
    TokenStore.announce();
  },

  subscribe: (listener: () => void): (() => void) => {
    TokenState.listeners.add(listener);
    return () => TokenState.listeners.delete(listener);
  },

  /** `useSyncExternalStore` compares by reference, so the snapshot is the held value itself. */
  snapshot: (): Held | undefined => TokenState.held,

  announce: (): void => {
    for (const listener of TokenState.listeners) listener();
  },
} as const;
