/**
 * The refresh token lives in a cookie; the access token never does.
 *
 * httpOnly puts the refresh token out of reach of any script on the page, so
 * an XSS bug cannot read it. `Path` scopes it to the auth endpoints, so it is
 * not attached to ordinary catalogue requests. SameSite=Lax blocks it from
 * cross-site POSTs while still surviving a normal top-level navigation, which
 * is what the OAuth redirect needs.
 */

import type { FastifyReply } from "fastify";

export const REFRESH_COOKIE = "hue_refresh";
export const OAUTH_STATE_COOKIE = "hue_oauth_state";

/** Everything under here, and nothing else, receives these cookies. */
const COOKIE_PATH = "/api/v1/auth";

export type CookieOptions = Readonly<{ secure: boolean }>;

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
