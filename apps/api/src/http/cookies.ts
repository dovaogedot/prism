/**
 * The refresh token lives in a cookie; the access token never does.
 *
 * httpOnly puts the refresh token out of reach of any script on the page, so
 * an XSS bug cannot read it. `Path` scopes it to the auth endpoints, so it is
 * not attached to ordinary catalog requests. SameSite=Lax blocks it from
 * cross-site POSTs while still surviving a normal top-level navigation, which
 * is what the OAuth redirect needs.
 */

import type { FastifyReply } from "fastify";

/** Carries the refresh token, which is the only credential that survives a reload. */
export const REFRESH_COOKIE = "hue_refresh";
/** Carries the value a provider must hand back, which is what proves the callback is ours. */
export const OAUTH_STATE_COOKIE = "hue_oauth_state";

/**
 * The two-factor challenge, when a provider sign-in raised one.
 *
 * A redirect has no SPA to hand the token to, and putting it in the URL would
 * leave it in history and in referrer headers. It is httpOnly, so the page
 * that collects the code never sees it — the server reads it back off the
 * request instead.
 */
export const TWO_FACTOR_COOKIE = "hue_2fa_challenge";

/** Everything under here, and nothing else, receives these cookies. */
const COOKIE_PATH = "/api/v1/auth";

/** Whether the connection is https, which decides the `Secure` attribute. */
export type CookieOptions = Readonly<{ secure: boolean }>;

/** Puts a refresh token in the browser, expiring when the token does. */
export const setRefreshCookie = (
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  options: CookieOptions,
): void => {
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    // Off over plain http, or localhost silently drops the cookie and every
    // refresh fails with no visible cause.
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
    expires: expiresAt,
  });
};

/** Takes the refresh token back, which is what signing out does to the browser. */
export const clearRefreshCookie = (
  reply: FastifyReply,
  options: CookieOptions,
): void => {
  reply.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
  });
};

/** Puts the state value in the browser for the length of one sign-in. */
export const setOAuthStateCookie = (
  reply: FastifyReply,
  state: string,
  options: CookieOptions,
): void => {
  reply.setCookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 600,
  });
};

/** Takes the state value back once the callback has checked it. */
export const clearOAuthStateCookie = (
  reply: FastifyReply,
  options: CookieOptions,
): void => {
  reply.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
  });
};

/** Short-lived: the challenge itself expires, this just stops it lingering. */
export const setTwoFactorCookie = (
  reply: FastifyReply,
  challengeToken: string,
  options: CookieOptions,
): void => {
  reply.setCookie(TWO_FACTOR_COOKIE, challengeToken, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 600,
  });
};

/** Takes the challenge back once the code has been accepted or the flow abandoned. */
export const clearTwoFactorCookie = (
  reply: FastifyReply,
  options: CookieOptions,
): void => {
  reply.clearCookie(TWO_FACTOR_COOKIE, {
    httpOnly: true,
    secure: options.secure,
    sameSite: "lax",
    path: COOKIE_PATH,
  });
};
