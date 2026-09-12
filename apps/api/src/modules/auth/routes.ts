/**
 * HTTP surface for authentication. Routes parse (the Zod schema does it),
 * call the service, and translate the `Result` into a response.
 */

import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  OAuthProvider,
  RegisterInput,
  ResetPasswordInput,
  TwoFactorCodeInput,
  TwoFactorLoginInput,
} from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Cookies, type CookieOptions } from "../../http/cookies.ts";
import { HttpErrors } from "../../http/errors.ts";
import type { Guards } from "../../http/guard.ts";
import { MockAuthorizationCode } from "../../platform/oauth.ts";
import { MockConsentPage } from "./mock-consent.ts";
import type { AuthService, IssuedSession, RequestContext } from "./service.ts";

/** What the auth routes need beyond the service itself. */
export type AuthRouteDependencies = Readonly<{
  service: AuthService;
  guards: Guards;
  cookies: CookieOptions;
  /** Present only in mock mode: the built-in consent screen signs codes with it. */
  mockOAuthSecret?: Uint8Array;
  publicWebOrigin: string;
  /** Per-address budget for credential-guessing endpoints. */
  authRateLimitPerMinute: number;
}>;

export const AuthRoutes = {
  isIssuedSession: (value: IssuedSession | { status: string }): value is IssuedSession =>
    "grant" in value && "refreshToken" in value,

  contextOf: (request: { headers: Readonly<Record<string, unknown>>; ip: string }): RequestContext => ({
    userAgent:
      typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 400) : "",
    ipAddress: request.ip,
  }),

  /** Mounts every auth endpoint. */
  register: (app: FastifyInstance, deps: AuthRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards, cookies } = deps;

    // Anything that checks a credential is the expensive thing to brute force;
    // a session refreshes far more often than it signs in.
    const strict = { rateLimit: { max: deps.authRateLimitPerMinute, timeWindow: "1 minute" } };
    const moderate = { rateLimit: { max: deps.authRateLimitPerMinute * 3, timeWindow: "1 minute" } };

    const providerParams = z.object({ provider: OAuthProvider.schema });
    const callbackUriFor = (provider: string): string =>
      `${deps.publicWebOrigin}/api/v1/auth/oauth/${provider}/callback`;

    routes.post("/register", { config: strict, schema: { body: RegisterInput.schema } }, async (request, reply) => {
      const result = await service.register({ ...request.body, context: AuthRoutes.contextOf(request) });

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
      return reply.status(201).send(result.value.grant);
    });

    routes.post("/login", { config: strict, schema: { body: LoginInput.schema } }, async (request, reply) => {
      const result = await service.login({ ...request.body, context: AuthRoutes.contextOf(request) });

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      const outcome = result.value;
      if (!AuthRoutes.isIssuedSession(outcome)) return reply.status(200).send(outcome);

      Cookies.setRefresh(reply, outcome.refreshToken, outcome.refreshExpiresAt, cookies);
      return reply.status(200).send({ status: "authenticated", grant: outcome.grant });
    });

    routes.post(
      "/login/2fa",
      { config: strict, schema: { body: TwoFactorLoginInput.schema } },
      async (request, reply) => {
        // The body's token wins; the cookie is what the OAuth redirect leaves behind.
        const challengeToken = request.body.challengeToken ?? request.cookies[Cookies.TWO_FACTOR];

        if (challengeToken === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.completeTwoFactorLogin({
          challengeToken,
          code: request.body.code,
          context: AuthRoutes.contextOf(request),
        });

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        Cookies.clearTwoFactor(reply, cookies);
        Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
        return reply.status(200).send({ status: "authenticated", grant: result.value.grant });
      },
    );

    routes.post("/refresh", { config: moderate }, async (request, reply) => {
      const presented = request.cookies[Cookies.REFRESH];

      if (presented === undefined) return HttpErrors.send(reply, { _tag: "RefreshTokenInvalid" });

      const result = await service.refresh(presented);

      if (result.isErr()) {
        // The cookie is spent either way.
        Cookies.clearRefresh(reply, cookies);
        return HttpErrors.send(reply, result.error);
      }

      Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
      return reply.status(200).send(result.value.grant);
    });

    routes.post("/logout", { preHandler: guards.requireUser }, async (request, reply) => {
      if (request.authenticated !== undefined) await service.logout(request.authenticated.sessionId);

      Cookies.clearRefresh(reply, cookies);
      return reply.status(204).send();
    });

    routes.get("/me", { preHandler: guards.requireUser }, async (request, reply) => {
      if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

      const result = await service.currentUser(request.authenticated.id);
      return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
    });

    routes.post(
      "/password/forgot",
      { config: strict, schema: { body: ForgotPasswordInput.schema } },
      async (request, reply) => {
        await service.requestPasswordReset(request.body.email);
        return reply.status(204).send();
      },
    );

    routes.post(
      "/password/reset",
      { config: strict, schema: { body: ResetPasswordInput.schema } },
      async (request, reply) => {
        const result = await service.resetPassword(request.body);

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        Cookies.clearRefresh(reply, cookies);
        return reply.status(204).send();
      },
    );

    routes.post(
      "/password",
      { preHandler: guards.requireUser, config: strict, schema: { body: ChangePasswordInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const { currentPassword, password } = request.body;
        const result = await service.changePassword({
          userId: request.authenticated.id,
          ...(currentPassword === undefined ? {} : { currentPassword }),
          password,
        });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.post("/2fa/setup", { preHandler: guards.requireUser, config: moderate }, async (request, reply) => {
      if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

      const result = await service.beginTwoFactorSetup(request.authenticated.id);
      return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
    });

    routes.post(
      "/2fa/enable",
      { preHandler: guards.requireUser, config: strict, schema: { body: TwoFactorCodeInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.enableTwoFactor({ userId: request.authenticated.id, code: request.body.code });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.post(
      "/2fa/disable",
      { preHandler: guards.requireUser, config: strict, schema: { body: TwoFactorCodeInput.schema } },
      async (request, reply) => {
        if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });

        const result = await service.disableTwoFactor({ userId: request.authenticated.id, code: request.body.code });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.get("/oauth/providers", async (_request, reply) => reply.send(service.availableProviders()));

    // Each provider gets its own callback URI, so a code issued by one cannot
    // be presented as if it came from another.
    routes.get(
      "/oauth/:provider",
      { config: moderate, schema: { params: providerParams } },
      async (request, reply) => {
        const result = await service.oauthAuthorizationUrl({
          provider: request.params.provider,
          redirectUri: callbackUriFor(request.params.provider),
        });

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        Cookies.setOAuthState(reply, result.value.state, cookies);
        return reply.redirect(result.value.url, 302);
      },
    );

    routes.get(
      "/oauth/:provider/callback",
      {
        config: moderate,
        schema: {
          params: providerParams,
          querystring: z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(512) }),
        },
      },
      async (request, reply) => {
        const expected = request.cookies[Cookies.OAUTH_STATE];

        Cookies.clearOAuthState(reply, cookies);

        if (expected === undefined || expected !== request.query.state) {
          return HttpErrors.send(reply, { _tag: "OAuthStateInvalid" });
        }

        const result = await service.completeOAuthLogin({
          provider: request.params.provider,
          code: request.query.code,
          redirectUri: callbackUriFor(request.params.provider),
          context: AuthRoutes.contextOf(request),
        });

        if (result.isErr()) {
          return reply.redirect(`${deps.publicWebOrigin}/login?error=${result.error._tag}`, 302);
        }

        if ("status" in result.value) {
          Cookies.setTwoFactor(reply, result.value.challengeToken, cookies);
          return reply.redirect(`${deps.publicWebOrigin}/login/2fa`, 302);
        }

        Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
        // The access token stays out of the URL; the page calls /refresh on arrival.
        return reply.redirect(`${deps.publicWebOrigin}/oauth/complete`, 302);
      },
    );

    const secret = deps.mockOAuthSecret;
    if (secret === undefined) return;

    routes.get(
      "/oauth/:provider/consent",
      {
        schema: {
          params: providerParams,
          querystring: z.object({ state: z.string().min(1).max(512), redirect_uri: z.string().min(1).max(2048) }),
        },
      },
      async (request, reply) =>
        reply.type("text/html; charset=utf-8").send(
          MockConsentPage.render({
            provider: request.params.provider,
            state: request.query.state,
            redirectUri: request.query.redirect_uri,
          }),
        ),
    );

    routes.post(
      "/oauth/:provider/consent",
      {
        config: moderate,
        schema: {
          params: providerParams,
          body: z.object({
            email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
            state: z.string().min(1).max(512),
            redirect_uri: z.string().min(1).max(2048),
          }),
        },
      },
      async (request, reply) => {
        const code = MockAuthorizationCode.issue(request.params.provider, request.body.email, secret);
        const params = new URLSearchParams({ code, state: request.body.state });

        return reply.redirect(`${request.body.redirect_uri}?${params}`, 302);
      },
    );
  },
} as const;
