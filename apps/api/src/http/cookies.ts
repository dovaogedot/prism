/**
 * The refresh token lives in a cookie; the access token never does. A guest's
 * cart is found by a cookie too.
 *
 * httpOnly keeps both away from page scripts, `Path` scopes each to the
 * endpoints that read it, and SameSite=Lax blocks cross-site POSTs while
 * still surviving the top-level navigation an OAuth redirect makes.
 */

import type { ChallengeToken } from "@prism/shared";
import type { FastifyReply } from "fastify";
import type { OAuthState } from "../platform/oauth.ts";
import type { CartToken, RefreshToken } from "../platform/tokens.ts";

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
  /** A guest's cart. Signed-in carts belong to the account instead. */
  CART: "prism_cart",
  /** Everything under here, and nothing else, receives the auth cookies. */
  PATH: "/api/v1/auth",
  /** The cart cookie travels with every API call, so the cart follows the guest to checkout. */
  CART_PATH: "/api/v1",

  /** The attributes every cookie here shares. `path` defaults to the auth endpoints. */
  attributes: (options: CookieOptions, path?: string) => ({
    httpOnly: true,
    // Off over plain http, or localhost drops the cookie with no visible cause.
    secure: options.secure,
    sameSite: "lax" as const,
    path: path ?? Cookies.PATH,
  }),

  /** Puts a refresh token in the browser, expiring when the token does. */
  setRefresh: (reply: FastifyReply, token: RefreshToken, expiresAt: Date, options: CookieOptions): void => {
    reply.setCookie(Cookies.REFRESH, token, { ...Cookies.attributes(options), expires: expiresAt });
  },

  clearRefresh: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.REFRESH, Cookies.attributes(options));
  },

  /** Keeps the state value for the length of one sign-in. */
  setOAuthState: (reply: FastifyReply, state: OAuthState, options: CookieOptions): void => {
    reply.setCookie(Cookies.OAUTH_STATE, state, { ...Cookies.attributes(options), maxAge: 600 });
  },

  clearOAuthState: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.OAUTH_STATE, Cookies.attributes(options));
  },

  /** Short-lived: the challenge itself expires, this only stops it lingering. */
  setTwoFactor: (reply: FastifyReply, challengeToken: ChallengeToken, options: CookieOptions): void => {
    reply.setCookie(Cookies.TWO_FACTOR, challengeToken, {
      ...Cookies.attributes(options),
      maxAge: 600,
    });
  },

  clearTwoFactor: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.TWO_FACTOR, Cookies.attributes(options));
  },

  /** Keeps a guest cart's token for as long as the cart lives. */
  setCart: (reply: FastifyReply, token: CartToken, expiresAt: Date, options: CookieOptions): void => {
    reply.setCookie(Cookies.CART, token, { ...Cookies.attributes(options, Cookies.CART_PATH), expires: expiresAt });
  },

  clearCart: (reply: FastifyReply, options: CookieOptions): void => {
    reply.clearCookie(Cookies.CART, Cookies.attributes(options, Cookies.CART_PATH));
  },
} as const;
