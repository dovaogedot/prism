/**
 * The access-token guard.
 *
 * A valid signature is necessary but not sufficient. The token carries a
 * session id, and this checks that session is still live on every request —
 * which is what makes revocation immediate rather than "within fifteen
 * minutes". That is one indexed primary-key lookup, and it is the price of
 * revocable stateless tokens.
 */

import type { DomainError, UserRole } from "@prism/shared";
import { Option } from "@prism/shared";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../platform/clock.ts";
import type { TokenService } from "../platform/tokens.ts";
import type { AuthRepository } from "../modules/auth/repository.ts";
import { sendDomainError } from "./errors.ts";

/** Who a request is from, once its token has been checked against a live session. */
export type AuthenticatedUser = Readonly<{
  id: string;
  sessionId: string;
  role: UserRole;
}>;

declare module "fastify" {
  interface FastifyRequest {
    /** `None` until a guard runs, and on routes that allow anonymous access. */
    authenticated: Option<AuthenticatedUser>;
  }
}

/**
 * Per-request storage for the decorator below.
 *
 * Fastify v5 refuses to decorate a request with any object reference, because
 * one object would be shared by every request. A WeakMap keyed by the request
 * gives genuine per-request state, and entries disappear with the request
 * itself rather than accumulating.
 */
const attachedUsers = new WeakMap<FastifyRequest, Option<AuthenticatedUser>>();

/** Gives every request an `authenticated` property, which starts out `None`. */
export const registerAuthenticatedDecorator = (app: {
  decorateRequest: (
    name: "authenticated",
    accessors: Readonly<{
      getter: (this: FastifyRequest) => Option<AuthenticatedUser>;
      setter: (this: FastifyRequest, value: Option<AuthenticatedUser>) => void;
    }>,
  ) => unknown;
}): void => {
  app.decorateRequest("authenticated", {
    getter(this: FastifyRequest) {
      const stored = attachedUsers.get(this);
      // Absent from the map means no guard has run — anonymous, not an error.
      return stored === undefined ? Option.none : stored;
    },
    setter(this: FastifyRequest, value: Option<AuthenticatedUser>) {
      attachedUsers.set(this, value);
    },
  });
};

/** What a guard needs to turn a bearer token into a user. */
export type GuardDependencies = Readonly<{
  tokens: TokenService;
  repository: AuthRepository;
  clock: Clock;
}>;

const BEARER = /^Bearer (.+)$/;

const readBearerToken = (request: FastifyRequest): Option<string> => {
  const header = request.headers.authorization;
  if (header === undefined) return Option.none;

  const match = BEARER.exec(header);
  return Option.fromNullable(match?.[1]);
};

const authenticate = (
  deps: GuardDependencies,
  request: FastifyRequest,
): ResultAsync<AuthenticatedUser, DomainError> => {
  const token = readBearerToken(request);

  if (Option.isNone(token)) {
    return errAsync<AuthenticatedUser, DomainError>({ _tag: "Unauthenticated" });
  }

  return deps.tokens.verifyAccessToken(token.value).andThen((claims) =>
    // The signature proves the token was issued. This proves it still counts.
    // fromSafePromise, not fromPromise: a database outage is not a domain
    // error, so it stays a rejection and surfaces as a 500 rather than being
    // mistaken for a revoked session.
    ResultAsync.fromSafePromise(
      deps.repository.isSessionLive(claims.sessionId, deps.clock.now()),
    ).andThen((live) =>
      live
        ? okAsync<AuthenticatedUser, DomainError>({
            id: claims.subject,
            sessionId: claims.sessionId,
            role: claims.role,
          })
        : errAsync<AuthenticatedUser, DomainError>({ _tag: "SessionRevoked" }),
    ),
  );
};

/**
 * The three preHandlers a route can be given.
 *
 * `required` answers 401 to an anonymous request, `optional` lets it through
 * with `authenticated` left `None`, and `admin` answers 403 to anyone else.
 */
export const createGuards = (deps: GuardDependencies) => {
  const attach = async (
    request: FastifyRequest,
    reply: FastifyReply,
    required: boolean,
    adminOnly: boolean,
  ): Promise<FastifyReply | undefined> => {
    const result = await authenticate(deps, request);

    if (result.isErr()) {
      if (!required) {
        request.authenticated = Option.none;
        return undefined;
      }
      return sendDomainError(reply, result.error);
    }

    if (adminOnly && result.value.role !== "admin") {
      return sendDomainError(reply, { _tag: "Forbidden" });
    }

    request.authenticated = Option.some(result.value);
    return undefined;
  };

  const requireUser: preHandlerHookHandler = async (request, reply) =>
    attach(request, reply, true, false);

  const requireAdmin: preHandlerHookHandler = async (request, reply) =>
    attach(request, reply, true, true);

  const optionalUser: preHandlerHookHandler = async (request, reply) =>
    attach(request, reply, false, false);

  return { requireUser, requireAdmin, optionalUser };
};

