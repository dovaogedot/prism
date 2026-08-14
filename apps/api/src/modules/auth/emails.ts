/**
 * Email bodies as pure functions: input in, `Email` out, nothing sent.
 * That makes them trivially unit-testable and keeps the service free of markup.
 */

import type { Email } from "../../platform/mailer.ts";

/**
 * The URL is the only interpolation, and it is percent-encoded by the caller.
 * Nothing user-supplied reaches the HTML, so there is no injection surface.
 */
export const passwordResetEmail = (input: {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}): Email => ({
  to: input.to,
  subject: "Reset your Hue & Cry password",
  text: [
    "Someone asked to reset the password on this Hue & Cry account.",
    "",
    `Open this link to choose a new one (it expires in ${input.expiresInMinutes} minutes):`,
    input.resetUrl,
    "",
    "If that wasn't you, ignore this email — nothing has changed.",
  ].join("\n"),
  html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Hue &amp; Cry</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">Reset your password</h1>
      <p style="margin:0 0 24px;line-height:1.6;color:#334155">
        Someone asked to reset the password on this account. Choose a new one below —
        this link expires in ${input.expiresInMinutes} minutes.
      </p>
      <a href="${input.resetUrl}"
         style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
        Choose a new password
      </a>
      <p style="margin:24px 0 0;line-height:1.6;color:#64748b;font-size:14px">
        If that wasn't you, ignore this email — nothing has changed.
      </p>
    </div>
  </body>
</html>`,
});
