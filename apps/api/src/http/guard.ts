/**
 * The access-token guards. A valid signature is necessary but not sufficient:
 * the token carries a session id, and every request checks that the session
 * is still live and its account enabled, which makes revocation immediate.
 * The same query reads the account's staff roles and when the session last
 * passed a TOTP check, which is all the staff guard needs.
 */

import { Permission, type DomainError, type StaffRole, type UserId } from "@prism/shared";
import type { FastifyInstance, FastifyRequest, onRequestHookHandler, preHandlerHookHandler } from "fastify";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { SessionId } from "../db/ids.ts";
import type { AuthRepository } from "../modules/auth/repository.ts";
import type { StaffActor } from "../modules/staff/audit.ts";
import type { Clock } from "../platform/clock.ts";
import type { RateLimitPolicyName } from "../platform/rate-limit.ts";
import type { TokenService } from "../platform/tokens.ts";
import { HttpErrors } from "./errors.ts";

/** Who a request is from, once its token has been checked against a live session. */
export type AuthenticatedUser = Readonly<{
  id: UserId;
  sessionId: SessionId;
  /** The account's staff roles; empty for a customer. */
  roles: readonly StaffRole[];
  hasTwoFactor: boolean;
  /** When the session last passed a TOTP check; absent when it never did. */
  secondFactorAt?: Date;
}>;

/** What an admin route requires: one permission, or any staff role at all. */
export type StaffRequirement = Permission | "any-staff";

declare module "fastify" {
  // The one place an interface is unavoidable: merging into Fastify's declaration.
  interface FastifyRequest {
    /** Undefined until the guard has run. */
    authenticated: AuthenticatedUser | undefined;
  }

  interface FastifyContextConfig {
    /** What the staff guard of an admin route requires, so tests can walk every admin route. */
    permission?: StaffRequirement;
  }
}

/** What a guard needs to turn a bearer token into a user. */
export type GuardDependencies = Readonly<{
  tokens: TokenService;
  repository: AuthRepository;
  clock: Clock;
  /** How long a session's TOTP check opens the admin. */
  staffVerificationTtlSeconds: number;
}>;

/**
 * The route options of an admin route: its guard, and the config that names
 * what it requires. The guard runs when the request arrives, before its body
 * is parsed or validated, so an account without the permission learns
 * nothing about what the route accepts.
 */
export type AdminRouteOptions = Readonly<{
  onRequest: onRequestHookHandler;
  config: Readonly<{ permission: StaffRequirement; rateLimit: RateLimitPolicyName }>;
}>;

/** The preHandlers that turn a bearer token into `request.authenticated`. */
export type Guards = Readonly<{
  /** Answers 401 to a request without a live session. */
  requireUser: preHandlerHookHandler;
  /**
   * Lets a request without an `Authorization` header through as a guest. A
   * header that fails verification still answers 401, so the browser
   * refreshes and retries instead of acting as a guest by mistake.
   */
  optionalUser: preHandlerHookHandler;
  /**
   * Admits a staff account whose roles grant `requirement`, that has 2FA on,
   * and whose session passed a TOTP check within the verification window.
   * Answers 401 without a session, 403 `Forbidden` without the permission,
   * and 403 `TwoFactorSetupRequired` or `TwoFactorVerificationRequired`
   * when the second factor is missing or stale.
   */
  staff: (requirement: StaffRequirement) => onRequestHookHandler;
  /** The options of an admin route that requires `requirement`, under the `rateLimit` policy. */
  admin: (requirement: StaffRequirement, rateLimit?: RateLimitPolicyName) => AdminRouteOptions;
}>;

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
        deps.repository.liveSession(claims.sessionId, claims.subject, deps.clock.now()),
      ).andThen((state) =>
        state === undefined
          ? errAsync<AuthenticatedUser, DomainError>({ _tag: "SessionRevoked" })
          : okAsync<AuthenticatedUser, DomainError>({
              id: claims.subject,
              sessionId: claims.sessionId,
              roles: state.roles,
              hasTwoFactor: state.hasTwoFactor,
              ...(state.secondFactorAt === undefined ? {} : { secondFactorAt: state.secondFactorAt }),
            }),
      ),
    );
  },

  /** Why `user` may not use a route that requires `requirement`, or `undefined` when it may. */
  staffRefusal: (
    user: AuthenticatedUser,
    requirement: StaffRequirement,
    now: Date,
    verificationTtlSeconds: number,
  ): DomainError | undefined => {
    const isPermitted =
      requirement === "any-staff" ? user.roles.length > 0 : Permission.can(user.roles, requirement);

    if (!isPermitted) return { _tag: "Forbidden" };
    if (!user.hasTwoFactor) return { _tag: "TwoFactorSetupRequired" };

    const checkedAt = user.secondFactorAt;
    if (checkedAt === undefined || now.getTime() - checkedAt.getTime() >= verificationTtlSeconds * 1000) {
      return { _tag: "TwoFactorVerificationRequired" };
    }

    return undefined;
  },

  /** The staff member behind an admin request, as the audit log records it. */
  actorOf: (request: FastifyRequest): StaffActor | undefined =>
    request.authenticated === undefined
      ? undefined
      : { id: request.authenticated.id, roles: request.authenticated.roles, ip: request.ip },

  create: (deps: GuardDependencies): Guards => {
    const staff = (requirement: StaffRequirement): onRequestHookHandler => async (request, reply) => {
      const result = await Guards.authenticate(deps, request);

      if (result.isErr()) return HttpErrors.send(reply, result.error);

      const refusal = Guards.staffRefusal(result.value, requirement, deps.clock.now(), deps.staffVerificationTtlSeconds);
      if (refusal !== undefined) return HttpErrors.send(reply, refusal);

      request.authenticated = result.value;
      return undefined;
    };

    return {
      requireUser: async (request, reply) => {
        const result = await Guards.authenticate(deps, request);

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        request.authenticated = result.value;
        return undefined;
      },

      optionalUser: async (request, reply) => {
        if (request.headers.authorization === undefined) return undefined;

        const result = await Guards.authenticate(deps, request);

        if (result.isErr()) return HttpErrors.send(reply, result.error);

        request.authenticated = result.value;
        return undefined;
      },

      staff,

      admin: (requirement, rateLimit = "default") => ({
        onRequest: staff(requirement),
        config: { permission: requirement, rateLimit },
      }),
    };
  },
} as const;
