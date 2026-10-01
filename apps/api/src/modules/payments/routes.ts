/**
 * The webhook Stripe calls. Its signature covers the exact bytes Stripe
 * sent, so this route reads the body as a buffer instead of parsing JSON;
 * the parser change is scoped to this one plugin.
 */

import type { FastifyInstance } from "fastify";
import { HttpErrors } from "../../http/errors.ts";
import type { PaymentService } from "./service.ts";

/** What the payment routes are served from. */
export type PaymentRouteDependencies = Readonly<{ service: PaymentService }>;

export const PaymentRoutes = {
  SIGNATURE_HEADER: "stripe-signature",

  /** Mounts the webhook in an encapsulated scope with a raw-body JSON parser. */
  register: async (app: FastifyInstance, deps: PaymentRouteDependencies): Promise<void> => {
    await app.register(async (scope) => {
      scope.removeContentTypeParser("application/json");
      scope.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

      scope.post("/payments/webhook", async (request, reply) => {
        const signature = request.headers[PaymentRoutes.SIGNATURE_HEADER];
        const body = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);

        const result = await deps.service.handleWebhook(body, typeof signature === "string" ? signature : undefined);

        // A failure to record answers 500 through the error handler, and Stripe retries.
        return result.isErr() ? HttpErrors.send(reply, result.error) : reply.status(200).send({ received: true });
      });
    });
  },
} as const;
