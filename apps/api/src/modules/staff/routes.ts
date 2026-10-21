/** HTTP surface of the staff module, under `/admin`: the dashboard and the audit log. */

import { AuditQuery } from "@prism/shared";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HttpErrors } from "../../http/errors.ts";
import type { Guards } from "../../http/guard.ts";
import type { AuditLog } from "./audit.ts";
import { StaffSummary, type SummaryCounters } from "./summary.ts";

/** What the staff routes are served from. */
export type StaffRouteDependencies = Readonly<{ guards: Guards; audit: AuditLog; counters: SummaryCounters }>;

export const StaffRoutes = {
  /** Mounts the dashboard and the audit log. */
  register: (app: FastifyInstance, deps: StaffRouteDependencies): void => {
    const routes = app.withTypeProvider<ZodTypeProvider>();

    routes.get("/summary", deps.guards.admin("any-staff"), async (request, reply) => {
      if (request.authenticated === undefined) return HttpErrors.send(reply, { _tag: "Unauthenticated" });
      return StaffSummary.of(deps.counters, request.authenticated.roles);
    });

    routes.get("/audit", { ...deps.guards.admin("audit.view"), schema: { querystring: AuditQuery.schema } }, async (request) =>
      deps.audit.list(request.query),
    );
  },
} as const;
