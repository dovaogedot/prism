/**
 * CAPTCHA verification for registration. Google publishes a site/secret key
 * pair that always verifies, so the widget and the check are real with no
 * account; supply a secret key and the same code path verifies for real.
 */

import type { DomainError } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

/** Deciding whether a widget response came from a person. */
export type CaptchaVerifier = Readonly<{
  verify: (response: string, remoteIp: string) => ResultAsync<true, DomainError>;
}>;

export const CaptchaVerifier = {
  /** Google's documented always-pass test secret, which accepts every response. */
  TEST_SECRET_KEY: "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe",
  SITEVERIFY_URL: "https://www.google.com/recaptcha/api/siteverify",
  rejected: { _tag: "CaptchaRejected" } as DomainError,

  /** Accepts any non-empty response without a network call. */
  test: (): CaptchaVerifier => ({
    verify: (response) =>
      response.trim().length > 0 ? okAsync(true) : errAsync(CaptchaVerifier.rejected),
  }),

  /** Asks Google about the response. A verification that cannot be made is a rejection. */
  google: (secretKey: string): CaptchaVerifier => ({
    verify: (response, remoteIp) => {
      if (response.trim().length === 0) return errAsync(CaptchaVerifier.rejected);

      const body = new URLSearchParams({ secret: secretKey, response });
      if (remoteIp.length > 0) body.set("remoteip", remoteIp);

      return ResultAsync.fromPromise(
        fetch(CaptchaVerifier.SITEVERIFY_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(5000),
        }).then((httpResponse): Promise<unknown> => httpResponse.json()),
        () => CaptchaVerifier.rejected,
      ).andThen((payload) =>
        typeof payload === "object" &&
        payload !== null &&
        "success" in payload &&
        payload.success === true
          ? okAsync(true as const)
          : errAsync(CaptchaVerifier.rejected),
      );
    },
  }),
} as const;
