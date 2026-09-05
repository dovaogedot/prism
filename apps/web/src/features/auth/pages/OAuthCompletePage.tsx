import { useState } from "react";
import { useNavigate } from "react-router";

/** Where a provider's callback lands the browser, on its way to the catalog. */
export const OAuthCompletePage = () => {
  const navigate = useNavigate();

  // The callback set a refresh cookie and sent us here with no token in the
  // URL. Trading the cookie for an access token is what `useSessionBootstrap`
  // already does on mount, so this page only has to wait and move on.
  useState(() => {
    setTimeout(() => void navigate("/", { replace: true }), 400);
  });

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <p className="text-sm text-ink-soft">Signing you in…</p>
    </div>
  );
};
