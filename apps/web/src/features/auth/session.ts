/**
 * Session state for React, read straight from the in-memory token store.
 *
 * There is no context provider and no duplicated copy in component state —
 * `useSyncExternalStore` subscribes to the store itself, so a sign-out from
 * anywhere is immediately visible everywhere.
 */

import { Option, type SessionUser } from "@prism/shared";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { api, refreshSession } from "../../shared/api/client.ts";
import { tokenStore } from "./token-store.ts";

export const useSession = (): Option<SessionUser> => {
  const held = useSyncExternalStore(tokenStore.subscribe, tokenStore.snapshot);
  return Option.map((value: { user: SessionUser }) => value.user)(held);
};

/**
 * On first mount, trade the httpOnly refresh cookie for an access token.
 * Until this settles the app cannot know whether it has a signed-in visitor,
 * which is why the header renders nothing rather than flashing "Sign in".
 */
export const useSessionBootstrap = (): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let canceled = false;

    void refreshSession().finally(() => {
      if (!canceled) setReady(true);
    });

    return () => {
      canceled = true;
    };
  }, []);

  return ready;
};

export const useSignOut = (): (() => Promise<void>) =>
  useCallback(async () => {
    // Best effort: the cookie is cleared by the server, but a failed request
    // must still drop the in-memory token or the UI would look signed in.
    await api.postEmpty("/auth/logout").catch(() => undefined);
    tokenStore.clear();
  }, []);
