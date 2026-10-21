/**
 * Cache headers for every API answer. A read the same for everyone, asked
 * without an `Authorization` header, may be kept for a minute by the browser
 * or any CDN in front of the site, and served a little stale while it
 * refreshes. Every other answer is personal or a change, and is kept by
 * nobody.
 */

import type { FastifyInstance } from "fastify";

declare module "fastify" {
  // The one place an interface is unavoidable: merging into Fastify's declaration.
  interface FastifyContextConfig {
    /** `public` marks a read whose answer is the same for every reader. */
    cache?: "public";
  }
}

export const CachePolicy = {
  PUBLIC: "public, max-age=60, stale-while-revalidate=300",
  PRIVATE: "private, no-store",

  /** Sets `Cache-Control` on every answer under `prefix` that does not set its own. */
  register: (app: FastifyInstance, prefix: string): void => {
    app.addHook("onSend", async (request, reply) => {
      if (!request.url.startsWith(prefix) || reply.hasHeader("cache-control")) return;

      const isShared =
        request.routeOptions.config.cache === "public" &&
        (request.method === "GET" || request.method === "HEAD") &&
        request.headers.authorization === undefined &&
        reply.statusCode < 400;

      reply.header("Cache-Control", isShared ? CachePolicy.PUBLIC : CachePolicy.PRIVATE);
    });
  },
} as const;
