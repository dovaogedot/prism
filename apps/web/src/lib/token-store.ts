/**
 * The access token lives here and nowhere else.
 *
 * A module-level variable, deliberately. It is never written to localStorage
 * or sessionStorage, so there is nothing for an injected script to read and
 * nothing that survives the tab closing. What survives a reload is the
 * httpOnly refresh cookie, which script cannot touch either — the app trades
 * it for a fresh access token on boot.
 */

import { Option, type SessionUser } from "@hue/shared";

type Held = Readonly<{ token: string; user: SessionUser }>;

let held: Option<Held> = Option.none;

/** Notified on sign-in and sign-out so React can re-render. */
const listeners = new Set<() => void>();

const announce = (): void => {
  for (const listener of listeners) listener();
};

export const tokenStore = {
  get: (): Option<string> =>
    Option.map((value: Held) => value.token)(held),

  user: (): Option<SessionUser> =>
    Option.map((value: Held) => value.user)(held),

  set: (token: string, user: SessionUser): void => {
    held = Option.some({ token, user });
    announce();
  },

  /** Replaces the cached user without disturbing a valid token. */
  updateUser: (user: SessionUser): void => {
    held = Option.map((value: Held) => ({ ...value, user }))(held);
    announce();
  },

  clear: (): void => {
    held = Option.none;
    announce();
  },

  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** `useSyncExternalStore` compares by reference, so the snapshot is stable. */
  snapshot: (): Option<Held> => held,
} as const;
