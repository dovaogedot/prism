/**
 * The access-token guard. A valid signature is necessary but not sufficient:
 * the token carries a session id, and every request checks that the session
 * is still live, which makes revocation immediate.
 */

import type { DomainError, UserId } from "@prism/shared";
import type { FastifyInstance, FastifyRequest, preHandlerHookHandler } from "fastify";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionId } from "../db/ids.ts";
import type { AuthRepository } from "../modules/auth/repository.ts";
import type { Clock } from "../platform/clock.ts";
import type { TokenService } from "../platform/tokens.ts";
import { HttpErrors } from "./errors.ts";

/** Who a request is from, once its token has been checked against a live session. */
export type AuthenticatedUser = Readonly<{ id: UserId; sessionId: SessionId }>;

declare module "fastify" {
  // The one place an interface is unavoidable: merging into Fastify's declaration.
  interface FastifyRequest {
    /** Undefined until the guard has run. */
    authenticated: AuthenticatedUser | undefined;
  }
}

/** What a guard needs to turn a bearer token into a user. */
export type GuardDependencies = Readonly<{
  tokens: TokenService;
  repository: AuthRepository;
  clock: Clock;
}>;

/** The preHandler that answers 401 to a request without a live session. */
export type Guards = Readonly<{ requireUser: preHandlerHookHandler }>;

export const Guards = {
  BEARER: /^Bearer (.+)$/,

  /**
   * Fastify refuses to decorate a request with an object reference, since one
   * object would be shared by every request; a WeakMap keyed by the request
   * gives per-request state that dies with the request.
   */
  attached: new WeakMap<FastifyRequest, AuthenticatedUser>(),

  /** Gives every request an `authenticated` property. */
  decorate: (app: FastifyInstance): void => {
    app.decorateRequest("authenticated", {
      getter(this: FastifyRequest) {
        return Guards.attached.get(this);
      },
      setter(this: FastifyRequest, value: AuthenticatedUser | undefined) {
        if (value === undefined) Guards.attached.delete(this);
        else Guards.attached.set(this, value);
      },
    });
  },

  authenticate: (
    deps: GuardDependencies,
    request: FastifyRequest,
  ): ResultAsync<AuthenticatedUser, DomainError> => {
    const token = Guards.BEARER.exec(request.headers.authorization ?? "")?.[1];

    if (token === undefined) {
      return errAsync<AuthenticatedUser, DomainError>({ _tag: "Unauthenticated" });
    }

    return deps.tokens.verifyAccessToken(token).andThen((claims) =>
      // fromSafePromise: a database outage is a 500, not a revoked session.
      ResultAsync.fromSafePromise(
        deps.repository.isSessionLive(claims.sessionId, deps.clock.now()),
      ).andThen((live) =>
        live
          ? okAsync<AuthenticatedUser, DomainError>({
              id: claims.subject,
              sessionId: claims.sessionId,
            })
          : errAsync<AuthenticatedUser, DomainError>({ _tag: "SessionRevoked" }),
      ),
    );
  },

  create: (deps: GuardDependencies): Guards => ({
    requireUser: async (request, reply) => {
      const result = await Guards.authenticate(deps, request);

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      request.authenticated = result.value;
      return undefined;
    },
  }),
} as const;
