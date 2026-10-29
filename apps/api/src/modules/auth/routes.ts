/**
 * HTTP surface for authentication. Routes parse (the Zod schema does it),
 * call the service, and translate the `Result` into a response.
 */

import {
  ChallengeToken,
  ChangePasswordInput,
  Email,
  EnableTwoFactorInput,
  ForgotPasswordInput,
  LoginInput,
  OAuthProvider,
  RegisterInput,
  ResetPasswordInput,
  TwoFactorCodeInput,
  TwoFactorLoginInput,
  type DomainError,
} from "@prism/shared";
import fastifyFormbody from "@fastify/formbody";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { Cookies, type CookieOptions } from "../../http/cookies.ts";
import { HttpErrors } from "../../http/errors.ts";
import { Guards } from "../../http/guard.ts";
import { AuthorizationCode, MockAuthorizationCode, OAuthState, RedirectUri } from "../../platform/oauth.ts";
import type { TakeResult } from "../../platform/rate-limit.ts";
import { RefreshToken } from "../../platform/tokens.ts";
import { MockConsentPage } from "./mock-consent.ts";
import type { AuthenticatedUser } from "../../http/guard.ts";
import type { AuthService, IssuedSession, RequestContext, SessionContext } from "./service.ts";

/** What the auth routes need beyond the service itself. */
export type AuthRouteDependencies = Readonly<{
  service: AuthService;
  guards: Guards;
  cookies: CookieOptions;
  /** Present only in mock mode: the built-in consent screen signs codes with it. */
  mockOAuthSecret?: Uint8Array;
  publicWebOrigin: string;
  /**
   * Takes a token from the sign-in budget of the account `email` names, which
   * holds however many addresses the guesses come from.
   */
  limitAccount: (email: Email) => TakeResult;
}>;

export const AuthRoutes = {
  isIssuedSession: (value: IssuedSession | { status: string }): value is IssuedSession =>
    "grant" in value && "refreshToken" in value,

  /** The session a guarded request arrived in. */
  sessionOf: (user: AuthenticatedUser): SessionContext => ({
    id: user.sessionId,
    ...(user.secondFactorAt === undefined ? {} : { secondFactorAt: user.secondFactorAt }),
  }),

  contextOf: (request: { headers: Readonly<Record<string, unknown>>; ip: string }): RequestContext => {
    const userAgent = request.headers["user-agent"];

    return {
      ...(typeof userAgent === "string" && userAgent.length > 0 ? { userAgent: userAgent.slice(0, 400) } : {}),
      ipAddress: request.ip,
    };
  },

  /** Mounts every auth endpoint. */
  register: (app: FastifyInstance, deps: AuthRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();
    const { service, guards, cookies } = deps;

    // Anything that checks a credential is the expensive thing to brute force;
    // a session refreshes far more often than it signs in.
    const credentials = { rateLimit: "credentials" } as const;
    const session = { rateLimit: "session" } as const;

    const providerParams = z.object({ provider: OAuthProvider.schema });
    const callbackUriFor = (provider: OAuthProvider): RedirectUri =>
      RedirectUri.schema.parse(`${deps.publicWebOrigin}/api/v1/auth/oauth/${provider}/callback`);

    routes.post("/register", { config: credentials, schema: { body: RegisterInput.schema } }, async (request, reply) => {
      const result = await service.register({ ...request.body, context: AuthRoutes.contextOf(request) });

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
      return reply.status(201).send(result.value.grant);
    });

    routes.post("/login", { config: credentials, schema: { body: LoginInput.schema } }, async (request, reply) => {
      const taken = deps.limitAccount(request.body.email);
      reply.header("RateLimit-Remaining", taken.remaining);

      const result = await service.login({
        email: request.body.email,
        password: request.body.password,
        ...(request.body.captchaToken === undefined ? {} : { captchaToken: request.body.captchaToken }),
        isCaptchaRequired: !taken.isAllowed,
        context: AuthRoutes.contextOf(request),
      });

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      const outcome = result.value;
      if (!AuthRoutes.isIssuedSession(outcome)) return reply.status(200).send(outcome);

      Cookies.setRefresh(reply, outcome.refreshToken, outcome.refreshExpiresAt, cookies);
      return reply.status(200).send({ status: "authenticated", grant: outcome.grant });
    });

    routes.post(
      "/login/2fa",
      { config: credentials, schema: { body: TwoFactorLoginInput.schema } },
      async (request, reply) => {
        // The body's token wins; the cookie is what the OAuth redirect leaves behind.
        const fromCookie = ChallengeToken.schema.safeParse(request.cookies[Cookies.TWO_FACTOR]);
        const challengeToken = request.body.challengeToken ?? (fromCookie.success ? fromCookie.data : undefined);

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

    routes.post("/refresh", { config: session }, async (request, reply) => {
      const presented = RefreshToken.schema.safeParse(request.cookies[Cookies.REFRESH]);

      if (!presented.success) return HttpErrors.send(reply, { _tag: "RefreshTokenInvalid" });

      const result = await service.refresh(presented.data);

      if (result.isErr()) {
        // The cookie is spent either way.
        Cookies.clearRefresh(reply, cookies);
        return HttpErrors.send(reply, result.error);
      }

      Cookies.setRefresh(reply, result.value.refreshToken, result.value.refreshExpiresAt, cookies);
      return reply.status(200).send(result.value.grant);
    });

    routes.post("/logout", { onRequest: guards.requireUser }, async (request, reply) => {
      if (request.authenticated !== undefined) await service.logout(request.authenticated.sessionId);

      Cookies.clearRefresh(reply, cookies);
      return reply.status(204).send();
    });

    routes.get("/me", { onRequest: guards.requireUser }, async (request, reply) => {
      const result = await service.currentUser(Guards.userOf(request).id, AuthRoutes.sessionOf(Guards.userOf(request)));
      return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
    });

    routes.post(
      "/password/forgot",
      { config: credentials, schema: { body: ForgotPasswordInput.schema } },
      async (request, reply) => {
        await service.requestPasswordReset(request.body.email);
        return reply.status(204).send();
      },
    );

    routes.post(
      "/password/reset",
      { config: credentials, schema: { body: ResetPasswordInput.schema } },
      async (request, reply) => {
        const result = await service.resetPassword(request.body);

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        Cookies.clearRefresh(reply, cookies);
        return reply.status(204).send();
      },
    );

    routes.post(
      "/password",
      { onRequest: guards.requireUser, config: credentials, schema: { body: ChangePasswordInput.schema } },
      async (request, reply) => {
        const { currentPassword, password } = request.body;
        const result = await service.changePassword({
          userId: Guards.userOf(request).id,
          session: AuthRoutes.sessionOf(Guards.userOf(request)),
          ...(currentPassword === undefined ? {} : { currentPassword }),
          password,
        });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.post("/2fa/setup", { onRequest: guards.requireUser }, async (request, reply) => {
      const result = await service.beginTwoFactorSetup(Guards.userOf(request).id);
      return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
    });

    routes.post(
      "/2fa/enable",
      { onRequest: guards.requireUser, config: credentials, schema: { body: EnableTwoFactorInput.schema } },
      async (request, reply) => {
        const result = await service.enableTwoFactor({
          userId: Guards.userOf(request).id,
          session: AuthRoutes.sessionOf(Guards.userOf(request)),
          code: request.body.code,
          ...(request.body.currentPassword === undefined ? {} : { currentPassword: request.body.currentPassword }),
          ipAddress: request.ip,
        });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.post(
      "/2fa/verify",
      { onRequest: guards.requireUser, config: credentials, schema: { body: TwoFactorCodeInput.schema } },
      async (request, reply) => {
        const result = await service.verifyTwoFactor({
          userId: Guards.userOf(request).id,
          session: AuthRoutes.sessionOf(Guards.userOf(request)),
          code: request.body.code,
          ipAddress: request.ip,
        });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.post(
      "/2fa/disable",
      { onRequest: guards.requireUser, config: credentials, schema: { body: TwoFactorCodeInput.schema } },
      async (request, reply) => {
        const result = await service.disableTwoFactor({
          userId: Guards.userOf(request).id,
          session: AuthRoutes.sessionOf(Guards.userOf(request)),
          code: request.body.code,
          ipAddress: request.ip,
        });
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send(result.value);
      },
    );

    routes.get("/oauth/providers", async (_request, reply) => reply.send(service.availableProviders()));

    // Each provider gets its own callback URI, so a code issued by one cannot
    // be presented as if it came from another.
    routes.get(
      "/oauth/:provider",
      { config: session, schema: { params: providerParams } },
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
        config: session,
        schema: {
          params: providerParams,
          // A browser lands here from the provider, so nothing in the query may fail as JSON:
          // a person who cancels comes back with `error` and no code.
          querystring: z.object({
            code: AuthorizationCode.schema.optional().catch(undefined),
            state: OAuthState.schema.optional().catch(undefined),
          }),
        },
      },
      async (request, reply) => {
        const expected = request.cookies[Cookies.OAUTH_STATE];
        const failWith = (tag: DomainError["_tag"]) => reply.redirect(`${deps.publicWebOrigin}/login?error=${tag}`, 302);

        Cookies.clearOAuthState(reply, cookies);

        if (expected === undefined || request.query.state === undefined || expected !== request.query.state) {
          return failWith("OAuthStateInvalid");
        }
        if (request.query.code === undefined) return failWith("OAuthCanceled");

        const result = await service.completeOAuthLogin({
          provider: request.params.provider,
          code: request.query.code,
          redirectUri: callbackUriFor(request.params.provider),
          context: AuthRoutes.contextOf(request),
        });

        if (result.isErr()) return failWith(result.error._tag);

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

    // The stand-in's consent screen is a plain HTML form, which posts urlencoded. Only this
    // scope parses that, so no other route takes a form another site can post without a preflight.
    routes.register(async (scope) => {
      await scope.register(fastifyFormbody);
      const consent = scope.withTypeProvider<ZodTypeProvider>();

      consent.get(
        "/oauth/:provider/consent",
        {
          schema: {
            params: providerParams,
            querystring: z.object({ state: OAuthState.schema }),
          },
        },
        async (request, reply) =>
          reply.type("text/html; charset=utf-8").send(MockConsentPage.render({ provider: request.params.provider, state: request.query.state })),
      );

      consent.post(
        "/oauth/:provider/consent",
        {
          config: session,
          schema: {
            params: providerParams,
            body: z.object({ email: Email.schema, state: OAuthState.schema }),
          },
        },
        async (request, reply) => {
          const code = MockAuthorizationCode.issue(request.params.provider, request.body.email, secret);
          const params = new URLSearchParams({ code, state: request.body.state });

          // The stand-in sends a person only to this shop's own callback, whatever the request named.
          return reply.redirect(`${callbackUriFor(request.params.provider)}?${params}`, 302);
        },
      );
    });
  },
} as const;
