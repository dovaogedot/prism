/**
 * Session state for React, read straight from the in-memory token store.
 *
 * There is no context provider and no duplicated copy in component state:
 * `useSyncExternalStore` subscribes to the store itself, so a sign-out from
 * anywhere is immediately visible everywhere.
 */

import type { SessionUser } from "@prism/shared";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { Api } from "../../shared/api/client.ts";
import { TokenStore } from "./token-store.ts";

/** Who is signed in, or `undefined`. Re-renders on every sign-in and sign-out. */
export const useSession = (): SessionUser | undefined =>
  useSyncExternalStore(TokenStore.subscribe, TokenStore.snapshot)?.user;

/**
 * On first mount, trades the httpOnly refresh cookie for an access token.
 * Until this settles the app cannot know whether it has a signed-in visitor,
 * which is why the header renders nothing rather than flashing "Sign in".
 */
export const useSessionBootstrap = (): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let canceled = false;

    void Api.refresh().finally(() => {
      if (!canceled) setReady(true);
    });

    return () => {
      canceled = true;
    };
  }, []);

  return ready;
};

/** Signs out. The in-memory token is dropped whether or not the server answers. */
export const useSignOut = (): (() => Promise<void>) =>
  useCallback(async () => {
    // The cookie is cleared by the server, but a failed request must still
    // drop the in-memory token or the UI would look signed in.
    await Api.postEmpty("/auth/logout").catch(() => undefined);
    TokenStore.clear();
  }, []);
