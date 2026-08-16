/**
 * HTTP surface for authentication.
 *
 * Routes do three things: parse (the Zod schema does it), call the service,
 * and translate the `Result` into a response. No domain logic lives here.
 */

import {
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  forgotPasswordSchema,
  loginSchema,
  oauthProviderSchema,
  registerSchema,
  resetPasswordSchema,
  setPasswordSchema,
  twoFactorLoginSchema,
  Option,
} from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  clearOAuthStateCookie,
  clearRefreshCookie,
  OAUTH_STATE_COOKIE,
  REFRESH_COOKIE,
  setOAuthStateCookie,
  setRefreshCookie,
  type CookieOptions,
} from "../../http/cookies.ts";
import { sendDomainError } from "../../http/errors.ts";
import type { createGuards } from "../../http/guard.ts";
import { issueMockAuthorizationCode } from "../../platform/oauth.ts";
import type { AuthService, IssuedSession, RequestContext } from "./service.ts";
import { renderMockConsentPage } from "./mock-consent.ts";

export type AuthRouteDependencies = Readonly<{
  service: AuthService;
  guards: ReturnType<typeof createGuards>;
  cookies: CookieOptions;
  /** Only present in mock mode — the built-in consent screen needs to sign codes. */
  mockOAuthSecret: Option<Uint8Array>;
  publicWebOrigin: string;
  /** Per-address budget for credential-guessing endpoints. */
  authRateLimitPerMinute: number;
}>;

const isIssuedSession = (
  value: IssuedSession | { status: string },
): value is IssuedSession => "grant" in value && "refreshToken" in value;

export const registerAuthRoutes = (
  app: FastifyInstance,
  deps: AuthRouteDependencies,
): void => {
  const routes = app.withTypeProvider<ZodTypeProvider>();
  const { service, guards, cookies } = deps;

  // Anything that checks a credential is the expensive thing to brute force.
  const STRICT_RATE_LIMIT = {
    rateLimit: { max: deps.authRateLimitPerMinute, timeWindow: "1 minute" },
  } as const;

  // Everything else gets a looser budget — a legitimate session refreshes far
  // more often than it signs in.
  const MODERATE_RATE_LIMIT = {
    rateLimit: { max: deps.authRateLimitPerMinute * 3, timeWindow: "1 minute" },
  } as const;

  const contextOf = (request: {
    headers: Readonly<Record<string, unknown>>;
    ip: string;
  }): RequestContext => ({
    userAgent:
      typeof request.headers["user-agent"] === "string"
        ? request.headers["user-agent"].slice(0, 400)
        : "",
    ipAddress: request.ip,
  });

  /* ------------------------------------------------------------- register */

  routes.post(
    "/register",
    {
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Create an account with an email address and password.",
        body: registerSchema,
      },
    },
    async (request, reply) => {
      const result = await service.register({
        ...request.body,
        context: contextOf(request),
      });

      if (result.isErr()) return sendDomainError(reply, result.error);

      setRefreshCookie(
        reply,
        result.value.refreshToken,
        result.value.refreshExpiresAt,
        cookies,
      );

      return reply.status(201).send(result.value.grant);
    },
  );

  /* ---------------------------------------------------------------- login */

  routes.post(
    "/login",
    {
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Sign in. Answers a 2FA challenge if the account requires one.",
        body: loginSchema,
      },
    },
    async (request, reply) => {
      const result = await service.login({
        ...request.body,
        context: contextOf(request),
      });

      if (result.isErr()) return sendDomainError(reply, result.error);

      const outcome = result.value;

      // Sign-in has two shapes. Only one of them sets a refresh cookie.
      if (!isIssuedSession(outcome)) return reply.status(200).send(outcome);

      setRefreshCookie(reply, outcome.refreshToken, outcome.refreshExpiresAt, cookies);

      return reply
        .status(200)
        .send({ status: "authenticated", grant: outcome.grant });
    },
  );

  routes.post(
    "/login/2fa",
    {
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Complete a sign-in that requires a second factor.",
        body: twoFactorLoginSchema,
      },
    },
    async (request, reply) => {
      const result = await service.completeTwoFactorLogin({
        ...request.body,
        context: contextOf(request),
      });

      if (result.isErr()) return sendDomainError(reply, result.error);

      setRefreshCookie(
        reply,
        result.value.refreshToken,
        result.value.refreshExpiresAt,
        cookies,
      );

      return reply
        .status(200)
        .send({ status: "authenticated", grant: result.value.grant });
    },
  );

  /* -------------------------------------------------------------- refresh */

  routes.post(
    "/refresh",
    {
      config: MODERATE_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary:
          "Exchange the refresh cookie for a new access token. Single-use: the old token is invalidated and reuse revokes the session.",
      },
    },
    async (request, reply) => {
      const presented = Option.fromNullable(request.cookies[REFRESH_COOKIE]);

      if (Option.isNone(presented)) {
        return sendDomainError(reply, { _tag: "RefreshTokenInvalid" });
      }

      const result = await service.refresh(presented.value);

      if (result.isErr()) {
        // The cookie is spent either way — leaving it in place only produces
        // a second failure on the next attempt.
        clearRefreshCookie(reply, cookies);
        return sendDomainError(reply, result.error);
      }

      setRefreshCookie(
        reply,
        result.value.refreshToken,
        result.value.refreshExpiresAt,
        cookies,
      );

      return reply.status(200).send(result.value.grant);
    },
  );

  routes.post(
    "/logout",
    {
      preHandler: guards.requireUser,
      schema: { tags: ["auth"], summary: "Revoke the current session." },
    },
    async (request, reply) => {
      const user = request.authenticated;

      if (Option.isSome(user)) await service.logout(user.value.sessionId);

      clearRefreshCookie(reply, cookies);
      return reply.status(204).send();
    },
  );

  routes.get(
    "/me",
    {
      preHandler: guards.requireUser,
      schema: { tags: ["auth"], summary: "The signed-in user." },
    },
    async (request, reply) => {
      const user = request.authenticated;

      if (Option.isNone(user)) {
        return sendDomainError(reply, { _tag: "Unauthenticated" });
      }

      const result = await service.currentUser(user.value.id);

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(200).send(result.value);
    },
  );

  /* ----------------------------------------------------- password recovery */

  routes.post(
    "/password/forgot",
    {
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary:
          "Send a reset link. Always answers 204, whether or not the address is registered.",
        body: forgotPasswordSchema,
      },
    },
    async (request, reply) => {
      await service.requestPasswordReset(request.body.email);
      return reply.status(204).send();
    },
  );

  routes.post(
    "/password/reset",
    {
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Set a new password using a reset token. Ends every session.",
        body: resetPasswordSchema,
      },
    },
    async (request, reply) => {
      const result = await service.resetPassword(request.body);

      if (result.isErr()) return sendDomainError(reply, result.error);

      clearRefreshCookie(reply, cookies);
      return reply.status(204).send();
    },
  );

  /* ------------------------------------------------------ two-factor setup */

  routes.post(
    "/2fa/setup",
    {
      preHandler: guards.requireUser,
      config: MODERATE_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Start 2FA enrolment. Returns an otpauth URI and a QR code.",
      },
    },
    async (request, reply) => {
      const user = request.authenticated;
      if (Option.isNone(user)) {
        return sendDomainError(reply, { _tag: "Unauthenticated" });
      }

      const result = await service.beginTwoFactorSetup(user.value.id);

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(200).send(result.value);
    },
  );

  routes.post(
    "/password",
    {
      preHandler: guards.requireUser,
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Add a password to an account that signed up through a provider.",
        body: setPasswordSchema,
      },
    },
    async (request, reply) => {
      const user = request.authenticated;
      if (Option.isNone(user)) {
        return sendDomainError(reply, { _tag: "Unauthenticated" });
      }

      const result = await service.setPassword({
        userId: user.value.id,
        password: request.body.password,
      });

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(200).send(result.value);
    },
  );

  routes.post(
    "/2fa/enable",
    {
      preHandler: guards.requireUser,
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Confirm enrolment by proving one live code.",
        body: enableTwoFactorSchema,
      },
    },
    async (request, reply) => {
      const user = request.authenticated;
      if (Option.isNone(user)) {
        return sendDomainError(reply, { _tag: "Unauthenticated" });
      }

      const result = await service.enableTwoFactor({
        userId: user.value.id,
        code: request.body.code,
      });

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(200).send(result.value);
    },
  );

  routes.post(
    "/2fa/disable",
    {
      preHandler: guards.requireUser,
      config: STRICT_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Turn 2FA off. Requires a live code, not just a session.",
        body: disableTwoFactorSchema,
      },
    },
    async (request, reply) => {
      const user = request.authenticated;
      if (Option.isNone(user)) {
        return sendDomainError(reply, { _tag: "Unauthenticated" });
      }

      const result = await service.disableTwoFactor({
        userId: user.value.id,
        code: request.body.code,
      });

      return result.isErr()
        ? sendDomainError(reply, result.error)
        : reply.status(200).send(result.value);
    },
  );

  /* ------------------------------------------------------------------ OAuth */

  /**
   * Each provider gets its own callback URI. Sharing one and switching on a
   * query parameter would mean a code issued by one provider could be
   * presented as if it came from another.
   */
  const callbackUriFor = (provider: string): string =>
    `${deps.publicWebOrigin}/api/v1/auth/oauth/${provider}/callback`;

  const providerParamsSchema = z.object({ provider: oauthProviderSchema });

  routes.get(
    "/oauth/providers",
    {
      schema: {
        tags: ["auth"],
        summary:
          "Which third-party sign-ins this instance can complete, so the UI shows only live buttons.",
      },
    },
    async (_request, reply) => reply.send(service.availableProviders()),
  );

  routes.get(
    "/oauth/:provider",
    {
      config: MODERATE_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "Begin sign-in with a third-party provider.",
        params: providerParamsSchema,
      },
    },
    async (request, reply) => {
      const result = await service.oauthAuthorizationUrl({
        provider: request.params.provider,
        redirectUri: callbackUriFor(request.params.provider),
      });

      if (result.isErr()) return sendDomainError(reply, result.error);

      // State is remembered in an httpOnly cookie and compared on return, so a
      // callback this browser did not initiate cannot sign anyone in.
      setOAuthStateCookie(reply, result.value.state, cookies);

      return reply.redirect(result.value.url, 302);
    },
  );

  routes.get(
    "/oauth/:provider/callback",
    {
      config: MODERATE_RATE_LIMIT,
      schema: {
        tags: ["auth"],
        summary: "The provider redirects here with an authorization code.",
        params: providerParamsSchema,
        querystring: z.object({
          code: z.string().min(1).max(2048),
          state: z.string().min(1).max(512),
        }),
      },
    },
    async (request, reply) => {
      const expected = Option.fromNullable(request.cookies[OAUTH_STATE_COOKIE]);

      clearOAuthStateCookie(reply, cookies);

      if (Option.isNone(expected) || expected.value !== request.query.state) {
        return sendDomainError(reply, { _tag: "OAuthStateInvalid" });
      }

      const result = await service.completeOAuthLogin({
        provider: request.params.provider,
        code: request.query.code,
        redirectUri: callbackUriFor(request.params.provider),
        context: contextOf(request),
      });

      if (result.isErr()) {
        return reply.redirect(
          `${deps.publicWebOrigin}/login?error=${result.error._tag}`,
          302,
        );
      }

      setRefreshCookie(
        reply,
        result.value.refreshToken,
        result.value.refreshExpiresAt,
        cookies,
      );

      // The access token is deliberately not in this URL — it would land in
      // browser history and any referrer header. The SPA calls /refresh on
      // arrival and gets one from the cookie that was just set.
      return reply.redirect(`${deps.publicWebOrigin}/oauth/complete`, 302);
    },
  );

  /* ------------------------------------------------- the offline mock IdP */

  if (Option.isSome(deps.mockOAuthSecret)) {
    const secret = deps.mockOAuthSecret.value;

    routes.get(
      "/oauth/:provider/consent",
      {
        schema: {
          tags: ["auth"],
          summary:
            "Stand-in consent screen used when OAUTH_MODE=mock, so the flow works with no third-party account.",
          params: providerParamsSchema,
          querystring: z.object({
            state: z.string().min(1).max(512),
            redirect_uri: z.string().min(1).max(2048),
          }),
        },
      },
      async (request, reply) =>
        reply
          .type("text/html; charset=utf-8")
          .send(
            renderMockConsentPage({
              provider: request.params.provider,
              state: request.query.state,
              redirectUri: request.query.redirect_uri,
            }),
          ),
    );

    routes.post(
      "/oauth/:provider/consent",
      {
        config: MODERATE_RATE_LIMIT,
        schema: {
          tags: ["auth"],
          summary: "The mock consent screen posts here, then redirects back.",
          params: providerParamsSchema,
          body: z.object({
            email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
            state: z.string().min(1).max(512),
            redirect_uri: z.string().min(1).max(2048),
          }),
        },
      },
      async (request, reply) => {
        const code = issueMockAuthorizationCode(
          request.params.provider,
          request.body.email,
          secret,
        );
        const params = new URLSearchParams({ code, state: request.body.state });

        return reply.redirect(`${request.body.redirect_uri}?${params}`, 302);
      },
    );
  }
};
