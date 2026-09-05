/**
 * The single place a `DomainError` becomes an HTTP response.
 *
 * Routes never choose a status code. They hand back a tagged error and the
 * exhaustive table in @prism/shared decides — so a new error variant cannot be
 * introduced without the compiler demanding a status and a message for it.
 */

import type { DomainError, ValidationIssue } from "@prism/shared";
import { httpStatusOf, toErrorResponse } from "@prism/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";

/** Answers a request with the status and body an error is defined to carry. */
export const sendDomainError = (
  reply: FastifyReply,
  error: DomainError,
): FastifyReply => reply.status(httpStatusOf(error)).send(toErrorResponse(error));

const toValidationIssues = (
  issues: readonly Readonly<{ instancePath?: string; message?: string }>[],
): readonly ValidationIssue[] =>
  issues.map((issue) => ({
    // Fastify reports `/email`; the browser's form fields are named `email`.
    path: (issue.instancePath ?? "").replace(/^\//, "").replace(/\//g, "."),
    message: issue.message ?? "Invalid value.",
  }));

/** Fastify hands the handler an `unknown`; these read it without casting. */
const statusCodeOf = (error: unknown): number | undefined =>
  typeof error === "object" &&
  error !== null &&
  "statusCode" in error &&
  typeof error.statusCode === "number"
    ? error.statusCode
    : undefined;

const messageOf = (error: unknown): string =>
  typeof error === "object" &&
  error !== null &&
  "message" in error &&
  typeof error.message === "string"
    ? error.message
    : "Invalid request.";

/**
 * Installs the handler everything escaping a route lands in.
 *
 * Schema failures become a structured 422 the client can attach to individual
 * fields; everything else is logged in full and reported as an opaque 500,
 * because an internal message is a gift to whoever provoked it.
 */
export const registerErrorHandler = (app: FastifyInstance): void => {
  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendDomainError(reply, {
        _tag: "ValidationFailed",
        issues: toValidationIssues(error.validation),
      });
    }

    const status = statusCodeOf(error);

    if (status === 429) {
      return sendDomainError(reply, { _tag: "RateLimited" });
    }

    if (status !== undefined && status < 500) {
      return sendDomainError(reply, {
        _tag: "ValidationFailed",
        issues: [{ path: "", message: messageOf(error) }],
      });
    }

    request.log.error({ err: error }, "unhandled error");

    return reply.status(500).send({
      error: {
        code: "InternalError",
        message: "Something went wrong on our side.",
        issues: [],
      },
    });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({
      error: { code: "NotFound", message: "No such endpoint.", issues: [] },
    }),
  );
};
