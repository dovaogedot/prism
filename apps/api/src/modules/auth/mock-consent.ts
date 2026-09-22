/**
 * The stand-in identity provider's consent screen, served when no provider
 * credentials are configured. Everything around it is real: the redirect,
 * the state check, the code exchange, the account link.
 */

import { OAuthProvider } from "@prism/shared";
import type { OAuthState, RedirectUri } from "../../platform/oauth.ts";

export const MockConsentPage = {
  escape: (value: string): string =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),

  /** The consent page, with every value it is given escaped into the markup. */
  render: (input: { provider: OAuthProvider; state: OAuthState; redirectUri: RedirectUri }): string => {
    const label = MockConsentPage.escape(OAuthProvider.label[input.provider]);

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Choose an account</title>
  <style>
    body { margin: 0; min-height: 100dvh; display: grid; place-items: center; font: 16px/1.5 system-ui, sans-serif; background: #f1f5f9; color: #0f172a; padding: 24px; }
    .card { width: 100%; max-width: 400px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; box-sizing: border-box; }
    .badge { display: inline-block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #b45309; background: #fef3c7; border-radius: 999px; padding: 4px 10px; margin-bottom: 16px; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 20px; color: #475569; font-size: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    input { width: 100%; padding: 10px 12px; font: inherit; border-radius: 8px; border: 1px solid #cbd5e1; box-sizing: border-box; }
    button { width: 100%; margin-top: 16px; padding: 11px 16px; font: inherit; font-weight: 600; border: 0; border-radius: 8px; cursor: pointer; background: #2563eb; color: #fff; }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">Mock ${label}</span>
    <h1>Choose an account</h1>
    <p>Stands in for ${label} so the OAuth flow works offline. Any address signs in; one that already has an account is linked to it.</p>
    <form method="post" action="/api/v1/auth/oauth/${MockConsentPage.escape(input.provider)}/consent">
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" required value="shopper@example.com" autocomplete="email">
      <input type="hidden" name="state" value="${MockConsentPage.escape(input.state)}">
      <input type="hidden" name="redirect_uri" value="${MockConsentPage.escape(input.redirectUri)}">
      <button type="submit">Continue</button>
    </form>
  </main>
</body>
</html>`;
  },
} as const;
