/** Email bodies as pure functions: input in, message out, nothing sent. */

import type { OutboundEmail } from "../../platform/mailer.ts";

export const PasswordResetEmail = {
  /** The URL is the only interpolation, and the caller percent-encodes it. */
  compose: (input: { to: string; resetUrl: string; expiresInMinutes: number }): OutboundEmail => ({
    to: input.to,
    subject: "Reset your Prism password",
    text: [
      "Someone asked to reset the password on this Prism account.",
      "",
      `Open this link to choose a new one (it expires in ${input.expiresInMinutes} minutes):`,
      input.resetUrl,
      "",
      "If that was not you, ignore this email. Nothing has changed.",
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Prism</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Reset your password</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#334155">
        Someone asked to reset the password on this account. Choose a new one below.
        This link expires in ${input.expiresInMinutes} minutes.
      </p>
      <a href="${input.resetUrl}"
         style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
        Choose a new password
      </a>
      <p style="margin:24px 0 0;line-height:1.6;color:#64748b;font-size:14px">
        If that was not you, ignore this email. Nothing has changed.
      </p>
    </div>
  </body>
</html>`,
  }),
} as const;
