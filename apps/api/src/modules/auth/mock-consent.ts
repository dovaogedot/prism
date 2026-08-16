/**
 * The stand-in identity provider's consent screen, used when OAUTH_MODE=mock.
 *
 * This exists so the OAuth requirement can be demonstrated on a machine with
 * no Google account and no internet. Everything around it is real — the
 * redirect, the `state` check, the authorization-code exchange, the account
 * link. Only the party asserting "yes, this is who they are" is local.
 */

import { OAUTH_PROVIDER_LABELS, type OAuthProviderName } from "@prism/shared";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const renderMockConsentPage = (input: {
  provider: OAuthProviderName;
  state: string;
  redirectUri: string;
}): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Choose an account</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100dvh; display: grid; place-items: center;
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
      background: #f1f5f9; color: #0f172a; padding: 24px;
    }
    .card {
      width: 100%; max-width: 400px; background: #fff; border: 1px solid #e2e8f0;
      border-radius: 16px; padding: 32px;
      box-shadow: 0 10px 30px -12px rgb(15 23 42 / .25);
    }
    .badge {
      display: inline-block; font-size: 11px; letter-spacing: .1em;
      text-transform: uppercase; color: #b45309; background: #fef3c7;
      border-radius: 999px; padding: 4px 10px; margin-bottom: 16px;
    }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0 0 20px; color: #475569; font-size: 14px; }
    label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; }
    input {
      width: 100%; padding: 10px 12px; font: inherit; border-radius: 8px;
      border: 1px solid #cbd5e1; background: #fff; color: inherit;
    }
    input:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
    button {
      width: 100%; margin-top: 16px; padding: 11px 16px; font: inherit;
      font-weight: 600; border: 0; border-radius: 8px; cursor: pointer;
      background: #2563eb; color: #fff;
    }
    button:hover { background: #1d4ed8; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b1120; color: #e2e8f0; }
      .card { background: #111827; border-color: #1f2937; }
      p { color: #94a3b8; }
      input { background: #0b1120; border-color: #334155; }
      .badge { color: #fde68a; background: #422006; }
      button { background: #facc15; color: #1c1917; }
      button:hover { background: #eab308; }
    }
  </style>
</head>
<body>
  <main class="card">
    <span class="badge">Mock ${escapeHtml(OAUTH_PROVIDER_LABELS[input.provider])}</span>
    <h1>Choose an account</h1>
    <p>
      Stands in for ${escapeHtml(OAUTH_PROVIDER_LABELS[input.provider])} so the OAuth
      flow works offline. Any address signs in; one that already has an account is
      linked to it rather than duplicated.
    </p>
    <form method="post" action="/api/v1/auth/oauth/${escapeHtml(input.provider)}/consent">
      <label for="email">Email address</label>
      <input id="email" name="email" type="email" required
             value="shopper@gmail.com" autocomplete="email">
      <input type="hidden" name="state" value="${escapeHtml(input.state)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}">
      <button type="submit">Continue</button>
    </form>
  </main>
</body>
</html>`;
