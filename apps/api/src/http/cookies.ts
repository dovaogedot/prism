/**
 * The refresh token lives in a cookie; the access token never does.
 *
 * httpOnly keeps the refresh token away from page scripts, `Path` scopes it
 * to the auth endpoints, and SameSite=Lax blocks cross-site POSTs while still
 * surviving the top-level navigation an OAuth redirect makes.
 */

import type { FastifyReply } from "fastify";

/** Whether the connection is https, which decides the `Secure` attribute. */
export type CookieOptions = Readonly<{ secure: boolean }>;

export const Cookies = {
  /** The refresh token, the only credential that survives a reload. */
  REFRESH: "prism_refresh",
  /** The value a provider must hand back, which proves the callback is ours. */
  OAUTH_STATE: "prism_oauth_state",
  /**
   * The two-factor challenge a provider sign-in raised. A redirect has no
   * page to hand the token to, and a URL would leave it in history.
   */
  TWO_FACTOR: "prism_2fa_challenge",
  /** Everything under here, and nothing else, receives these cookies. */
  PATH: "/api/v1/auth",

  attributes: (options: CookieOptions) => ({
    httpOnly: true,
    // Off over plain http, or localhost drops the cookie with no visible cause.
    secure: options.secure,
    sameSite: "lax" as const,
    path: Cookies.PATH,
  }),

  /** Puts a refresh token in the browser, expiring when the token does. */
  setRefresh: (reply: FastifyReply, token: string, expiresAt: Date, options: CookieOptions): void => {
    reply.setCookie(Cookies.REFRESH, token, { ...Cookies.attributes(options), expires: expiresAt });
  },

  clearRefresh: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.REFRESH, Cookies.attributes(options));
  },

  /** Keeps the state value for the length of one sign-in. */
  setOAuthState: (reply: FastifyReply, state: string, options: CookieOptions): void => {
    reply.setCookie(Cookies.OAUTH_STATE, state, { ...Cookies.attributes(options), maxAge: 600 });
  },

  clearOAuthState: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.OAUTH_STATE, Cookies.attributes(options));
  },

  /** Short-lived: the challenge itself expires, this only stops it lingering. */
  setTwoFactor: (reply: FastifyReply, challengeToken: string, options: CookieOptions): void => {
    reply.setCookie(Cookies.TWO_FACTOR, challengeToken, {
      ...Cookies.attributes(options),
      maxAge: 600,
    });
  },

  clearTwoFactor: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.TWO_FACTOR, Cookies.attributes(options));
  },
} as const;
