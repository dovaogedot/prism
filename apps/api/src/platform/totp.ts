/**
 * Time-based one-time passwords (RFC 6238), the second factor. One 30-second
 * step of tolerance either side of now lets a code typed as the period rolls
 * over still work; wider than that hands out replay windows.
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

export const TotpService = {
  ISSUER: "Prism",
  PERIOD_SECONDS: 30,

  /** Codes read against the injected clock. */
  create: (clock: Clock): TotpService => ({
    generateSecret: () => generateSecret(),

    keyUri: (accountEmail, secret) =>
      generateURI({
        strategy: "totp",
        issuer: TotpService.ISSUER,
        label: accountEmail,
        secret,
        period: TotpService.PERIOD_SECONDS,
        digits: 6,
      }),

    verify: (secret, code) =>
      verifySync({
        secret,
        token: code,
        strategy: "totp",
        period: TotpService.PERIOD_SECONDS,
        digits: 6,
        epoch: Math.floor(clock.now().getTime() / 1000),
        epochTolerance: TotpService.PERIOD_SECONDS,
      }).valid,

    qrCodeSvg: (uri) =>
      QRCode.toString(uri, {
        type: "svg",
        margin: 1,
        // Transparent background, so the page's own theme shows through.
        color: { dark: "#000000", light: "#00000000" },
      }),
  }),
} as const;
