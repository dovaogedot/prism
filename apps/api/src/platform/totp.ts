/**
 * Time-based one-time passwords (RFC 6238), the second factor.
 *
 * `epochTolerance` allows one 30-second step either side of now, so a code
 * typed as the period rolls over still works, and so does a phone whose clock
 * drifts a little. Wider than that starts handing out replay windows.
 *
 * otplib's verify returns a discriminated union rather than a boolean, which
 * this adapter narrows to the one bit the caller needs.
 */

import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import type { Clock } from "./clock.ts";

/** Enrolling a second factor, and checking the codes it produces. */
export type TotpService = Readonly<{
  generateSecret: () => string;
  /** The `otpauth://` URI an authenticator app consumes. */
  keyUri: (accountEmail: string, secret: string) => string;
  verify: (secret: string, code: string) => boolean;
  qrCodeSvg: (uri: string) => Promise<string>;
}>;

const ISSUER = "Prism";
const PERIOD_SECONDS = 30;

/** Codes read against the injected clock, one 30-second step of tolerance either side. */
export const createTotpService = (clock: Clock): TotpService => ({
  generateSecret: () => generateSecret(),

  keyUri: (accountEmail, secret) =>
    generateURI({
      strategy: "totp",
      issuer: ISSUER,
      label: accountEmail,
      secret,
      period: PERIOD_SECONDS,
      digits: 6,
    }),

  verify: (secret, code) =>
    verifySync({
      secret,
      token: code,
      strategy: "totp",
      period: PERIOD_SECONDS,
      digits: 6,
      epoch: Math.floor(clock.now().getTime() / 1000),
      epochTolerance: PERIOD_SECONDS,
    }).valid,

  qrCodeSvg: (uri) =>
    QRCode.toString(uri, {
      type: "svg",
      margin: 1,
      // Transparent background, black paths — the page's own theme shows through
      // and CSS can recolor the strokes for dark mode.
      color: { dark: "#000000", light: "#00000000" },
    }),
});
