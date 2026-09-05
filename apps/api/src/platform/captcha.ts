/**
 * CAPTCHA verification for registration.
 *
 * Google publishes a site/secret key pair that always verifies successfully,
 * intended for exactly this situation: the widget in the browser is the real
 * reCAPTCHA widget, and the check here is the real check, but neither needs an
 * account to exist. `test` mode short-circuits the network call and accepts any
 * non-empty response, which is what Google's test secret does anyway.
 *
 * Set CAPTCHA_MODE=google with your own keys and the same code path verifies
 * for real.
 */

import type { DomainError } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

/** Deciding whether a widget response came from a person. */
export type CaptchaVerifier = Readonly<{
  verify: (response: string, remoteIp: string) => ResultAsync<true, DomainError>;
}>;

/** Google's documented always-pass test secret, which accepts every response. */
export const RECAPTCHA_TEST_SECRET_KEY = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";

const SITEVERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";

const rejected: DomainError = { _tag: "CaptchaRejected" };

/** Accepts any non-empty response without a network call. */
export const createTestCaptchaVerifier = (): CaptchaVerifier => ({
  verify: (response) =>
    response.trim().length > 0 ? okAsync(true) : errAsync(rejected),
});

const isSuccessfulVerification = (payload: unknown): boolean =>
  typeof payload === "object" &&
  payload !== null &&
  "success" in payload &&
  payload.success === true;

/** Asks Google about the response. A verification that cannot be made is a rejection. */
export const createGoogleCaptchaVerifier = (
  secretKey: string,
): CaptchaVerifier => ({
  verify: (response, remoteIp) => {
    if (response.trim().length === 0) return errAsync(rejected);

    const body = new URLSearchParams({ secret: secretKey, response });
    if (remoteIp.length > 0) body.set("remoteip", remoteIp);

    return ResultAsync.fromPromise(
      fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(5000),
      }).then((httpResponse) => httpResponse.json()),
      () => rejected,
    ).andThen((payload) =>
      isSuccessfulVerification(payload) ? okAsync(true as const) : errAsync(rejected),
    );
  },
});
