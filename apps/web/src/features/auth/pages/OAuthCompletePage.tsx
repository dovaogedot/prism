import { useState } from "react";
import { useNavigate } from "react-router";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { NextPath } from "../next-path.ts";

/** Where a provider's callback lands the browser, on its way back to the page sign-in started from. */
export const OAuthCompletePage = () => {
  const navigate = useNavigate();

  // The callback set a refresh cookie and sent us here with no token in the
  // URL. Trading the cookie for an access token is what `useSessionBootstrap`
  // already does on mount, so this page only has to wait and move on.
  useState(() => {
    setTimeout(() => void navigate(NextPath.recall(), { replace: true }), 400);
  });

  return (
    <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
      <PageMeta title={PageText.oauth.title} description={PageText.oauth.description} isIndexed={false} />
      <h1 className="text-sm font-medium text-ink-soft">Signing you in…</h1>
    </div>
  );
};
