/**
 * A pathless layout route for pages that only make sense when signed out.
 *
 * A signed-in visitor who lands on one of these is sent to the account page
 * instead. `replace` keeps the spent page out of history, so Back skips over
 * it rather than bouncing off it again.
 */

import { useState } from "react";
import { Navigate, Outlet } from "react-router";
import { match } from "ts-pattern";
import { TokenStore } from "../token-store.ts";

/**
 * The question is whether the visitor was already signed in on arrival, not
 * whether they are signed in now, so the store is read once at mount rather
 * than subscribed to. A session appearing while one of these pages is open is
 * that page succeeding, and the page decides where to go next.
 */
export const GuestOnly = () => {
  const [signedInOnArrival] = useState(() => TokenStore.snapshot() !== undefined);

  return match(signedInOnArrival)
    .with(false, () => <Outlet />)
    .with(true, () => <Navigate to="/account" replace />)
    .exhaustive();
};
