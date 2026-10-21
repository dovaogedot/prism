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
  /**
   * A secret typed by a person, as the first admin's: base32 of at least 32
   * characters, which is 160 bits. Spaces, lowercase and `=` padding are
   * forgiven, as authenticator apps forgive them.
   */
  base32: z
    .string()
    .transform((value) => value.replace(/[\s=]/g, "").toUpperCase())
    .pipe(
      z
        .string()
        .regex(/^[A-Z2-7]+$/, "ADMIN_TOTP_SECRET must be base32: letters A to Z and digits 2 to 7.")
        .min(32, "ADMIN_TOTP_SECRET must be at least 32 base32 characters (160 bits)."),
    )
    .brand<"TotpSecret">(),
} as const;

/** Enrolling a second factor, and checking the codes it produces. */
export type TotpService = Readonly<{
  generateSecret: () => TotpSecret;
  /** The URI an authenticator app consumes. */
  keyUri: (accountEmail: Email, secret: TotpSecret) => OtpauthUri;
  /**
   * The time step `code` belongs to, when it is a live code for `secret` from
   * a step after `afterStep`; `undefined` otherwise. A caller stores the step
   * it accepted, so each code works once.
   */
  acceptedStep: (secret: TotpSecret, code: TotpCode, afterStep?: number) => number | undefined;
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

    acceptedStep: (secret, code, afterStep) => {
      const result = verifySync({
        secret,
        token: code,
        strategy: "totp",
        period: TotpService.PERIOD_SECONDS,
        digits: 6,
        epoch: Math.floor(clock.now().getTime() / 1000),
        epochTolerance: TotpService.PERIOD_SECONDS,
        ...(afterStep === undefined ? {} : { afterTimeStep: afterStep }),
      });

      return result.valid && "timeStep" in result ? result.timeStep : undefined;
    },

    qrCodeSvg: (uri) =>
      QRCode.toString(uri, {
        type: "svg",
        margin: 1,
        // Transparent background, so the page's own theme shows through.
        color: { dark: "#000000", light: "#00000000" },
      }),
  }),
} as const;
