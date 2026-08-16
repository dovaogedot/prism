/**
 * A pathless layout route for pages that only make sense when signed out.
 *
 * Signing in is not something you do twice, so a signed-in visitor who lands
 * on one of these — from a bookmark, from Back, from a stale tab — is sent to
 * the account page instead. `replace` keeps the spent page out of history, so
 * Back skips over it rather than bouncing off it again.
 *
 * The rule lives in the route table rather than inside each page: a new
 * signed-out page inherits it from where it is listed, instead of from
 * somebody remembering to copy a redirect into it.
 */

import { useState } from "react";
import { Navigate, Outlet } from "react-router";
import { match } from "ts-pattern";
import { Option } from "@prism/shared";
import { tokenStore } from "../token-store.ts";

/**
 * The question is whether the visitor was *already* signed in on arrival, not
 * whether they are signed in now — so the store is read once, at mount, rather
 * than subscribed to.
 *
 * A session appearing while one of these pages is open is that page succeeding.
 * Subscribing would turn every successful sign-in into a race: the form sends
 * you to the catalog, the guard sends you to the account page, and whichever
 * render commits first decides where you end up. Reading once means the guard
 * has no opinion about a session it watched being created.
 *
 * Sound because the root holds the first paint until the refresh cookie has
 * been exchanged, so this never reads a not-yet-known session as "signed out".
 */
export const GuestOnly = () => {
  const [signedInOnArrival] = useState(() => Option.isSome(tokenStore.snapshot()));

  return match(signedInOnArrival)
    .with(false, () => <Outlet />)
    .with(true, () => <Navigate to="/account" replace />)
    .exhaustive();
};
