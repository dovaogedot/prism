/** HTTP surface of the contact form. */

import { SupportMessageInput } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HttpErrors } from "../../http/errors.ts";
import type { SupportService } from "./service.ts";

/** What the contact route is served from. */
export type SupportRouteDependencies = Readonly<{ service: SupportService }>;

export const SupportRoutes = {
  register: (app: FastifyInstance, deps: SupportRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();

    routes.post(
      "/support/messages",
      { config: { rateLimit: "contact" }, schema: { body: SupportMessageInput.schema } },
      async (request, reply) => {
        const result = await deps.service.send(request.body, request.ip);
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(202).send();
      },
    );
  },
} as const;
