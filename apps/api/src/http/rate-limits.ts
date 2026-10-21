/**
 * The rate limits as HTTP. Every route under the API prefix falls under a
 * policy: the one its `config.rateLimit` names, or `default`. A route marked
 * `none` is never limited. Every answer of a limited route carries
 * `RateLimit-Remaining`, and a refusal is a 429 `RateLimited` with
 * `Retry-After`.
 */

import type { UserId } from "@prism/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RateLimiter, RateLimitPolicyName, TakeResult } from "../platform/rate-limit.ts";
import { HttpErrors } from "./errors.ts";

declare module "fastify" {
  // The one place an interface is unavoidable: merging into Fastify's declaration.
  interface FastifyContextConfig {
    /** The route's rate-limit policy. Absent means `default`; `none` exempts the route. */
    rateLimit?: RateLimitPolicyName | "none";
  }
}

/** What the hook needs beyond the limiter. */
export type RateLimitDependencies = Readonly<{
  limiter: RateLimiter;
  /** The user a request's bearer token names, when it carries a valid one. */
  userOf: (request: FastifyRequest) => Promise<UserId | undefined>;
  /** The path prefix the limits apply under. */
  prefix: string;
}>;

export const RateLimits = {
  /** The policy a route resolves to. */
  policyOf: (config: Readonly<{ rateLimit?: RateLimitPolicyName | "none" }>): RateLimitPolicyName | "none" =>
    config.rateLimit ?? "default",

  /**
   * Answers a refused request, or marks an allowed one with what is left.
   * Resolves to the reply when the request was refused.
   */
  apply: (reply: FastifyReply, result: TakeResult): FastifyReply | undefined => {
    reply.header("RateLimit-Remaining", result.remaining);

    if (result.allowed) return undefined;

    reply.header("Retry-After", result.retryAfterSeconds);
    return HttpErrors.send(reply, { _tag: "RateLimited", retryAfterSeconds: result.retryAfterSeconds });
  },

  /** Puts every route under its policy, before anything else about the request runs. */
  register: (app: FastifyInstance, deps: RateLimitDependencies): void => {
    app.addHook("onRequest", async (request, reply) => {
      if (!request.url.startsWith(deps.prefix)) return undefined;

      const name = RateLimits.policyOf(request.routeOptions.config);
      if (name === "none") return undefined;

      // An account-keyed policy is taken by its route, which has the parsed body.
      const policy = deps.limiter.policyOf(name);
      const user = policy.key === "user" ? await deps.userOf(request) : undefined;
      const key = user === undefined ? `address:${request.ip}` : `user:${user}`;

      return RateLimits.apply(reply, deps.limiter.take(name, key));
    });
  },
} as const;
