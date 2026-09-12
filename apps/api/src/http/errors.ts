/**
 * The single place a `DomainError` becomes an HTTP response. Routes never
 * choose a status code; the table in @prism/shared decides.
 */

import { DomainError, type ValidationIssue } from "@prism/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

export const HttpErrors = {
  /** Answers a request with the status and body an error is defined to carry. */
  send: (reply: FastifyReply, error: DomainError): FastifyReply =>
    reply.status(DomainError.httpStatus(error)).send(DomainError.toResponse(error)),

  /** Fastify reports `/email`; the browser's form fields are named `email`. */
  issuesOf: (
    issues: readonly Readonly<{ instancePath?: string; message?: string }>[],
  ): readonly ValidationIssue[] =>
    issues.map((issue) => ({
      path: (issue.instancePath ?? "").replace(/^\//, "").replace(/\//g, "."),
      message: issue.message ?? "Invalid value.",
    })),

  statusOf: (error: unknown): number | undefined =>
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : undefined,

  messageOf: (error: unknown): string =>
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "Invalid request.",

  /**
   * Installs the handler everything escaping a route lands in. Schema
   * failures become a structured 422; everything else is logged in full and
   * reported as an opaque 500.
   */
  register: (app: FastifyInstance): void => {
    app.setErrorHandler((error, request, reply) => {
      if (hasZodFastifySchemaValidationErrors(error)) {
        return HttpErrors.send(reply, {
          _tag: "ValidationFailed",
          issues: HttpErrors.issuesOf(error.validation),
        });
      }

      const status = HttpErrors.statusOf(error);

      if (status === 429) return HttpErrors.send(reply, { _tag: "RateLimited" });

      if (status !== undefined && status < 500) {
        return HttpErrors.send(reply, {
          _tag: "ValidationFailed",
          issues: [{ path: "", message: HttpErrors.messageOf(error) }],
        });
      }

      request.log.error({ err: error }, "unhandled error");

      return reply.status(500).send({
        error: { code: "InternalError", message: "Something went wrong on our side.", issues: [] },
      });
    });

    app.setNotFoundHandler((_request, reply) =>
      reply
        .status(404)
        .send({ error: { code: "NotFound", message: "No such endpoint.", issues: [] } }),
    );
  },
} as const;
