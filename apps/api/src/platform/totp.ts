/**
 * Time-based one-time passwords (RFC 6238), the second factor. One 30-second
 * step of tolerance either side of now lets a code typed as the period rolls
 * over still work; wider than that hands out replay windows.
 */

import { OtpauthUri, type Email, type TotpCode } from "@prism/shared";
import { generateSecret, generateURI, verifySync } from "otplib";
import QRCode from "qrcode";
import { z } from "zod";
import type { Clock } from "./clock.ts";

/** The secret an authenticator app and the server share. Only this service makes one. */
export type TotpSecret = z.infer<typeof TotpSecret.schema>;
export const TotpSecret = {
  schema: z.string().min(1).brand<"TotpSecret">(),
} as const;

/** Enrolling a second factor, and checking the codes it produces. */
export type TotpService = Readonly<{
  generateSecret: () => TotpSecret;
  /** The URI an authenticator app consumes. */
  keyUri: (accountEmail: Email, secret: TotpSecret) => OtpauthUri;
  verify: (secret: TotpSecret, code: TotpCode) => boolean;
  qrCodeSvg: (uri: OtpauthUri) => Promise<string>;
}>;

export const TotpService = {
  ISSUER: "Prism",
  PERIOD_SECONDS: 30,

  /** Codes read against the injected clock. */
  create: (clock: Clock): TotpService => ({
    generateSecret: () => TotpSecret.schema.parse(generateSecret()),

    keyUri: (accountEmail, secret) =>
      OtpauthUri.schema.parse(
        generateURI({
          strategy: "totp",
          issuer: TotpService.ISSUER,
          label: accountEmail,
          secret,
          period: TotpService.PERIOD_SECONDS,
          digits: 6,
        }),
      ),

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
