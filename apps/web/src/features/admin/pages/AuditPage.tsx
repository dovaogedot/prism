import { StaffRole, type AuditEventView, type Page } from "@prism/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, DataTable, EmptyState, Field, Pagination, Skeleton } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { CatalogParams } from "../../catalog/filters.ts";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/**
 * The audit log, newest first: every change staff made, who made it and
 * with which roles, from where, and each changed field before and after.
 * Filtered by action, target and dates; an account's page links here with
 * its own changes.
 */
export const AuditPage = () => {
  const [params, setParams] = useSearchParams();

  const query = params.toString();

  const events = useAdminRead<Page<AuditEventView>>(AdminKeys.list("audit", query), `/audit${query.length === 0 ? "" : `?${query}`}`);

  const [action, setAction] = useState(params.get("action") ?? "");

  const [targetType, setTargetType] = useState(params.get("targetType") ?? "");

  const [targetId, setTargetId] = useState(params.get("targetId") ?? "");

  return (
    <AdminPage text={PageText.adminAudit} heading="Audit log">
      <form
        className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setParams(CatalogParams.set(CatalogParams.set(CatalogParams.set(params, "action", action.trim()), "targetType", targetType.trim()), "targetId", targetId.trim()));
        }}
      >
        <Field label="Action" id="audit-action" placeholder="product. or order.refund" value={action} onChange={(event) => setAction(event.target.value)} />
        <Field label="Target type" id="audit-target-type" placeholder="product" value={targetType} onChange={(event) => setTargetType(event.target.value)} />
        <Field label="Target id" id="audit-target-id" value={targetId} onChange={(event) => setTargetId(event.target.value)} />
        <Button type="submit" tone="quiet">
          Find
        </Button>
        <Field label="From" id="audit-from" type="date" value={params.get("from") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "from", event.target.value))} />
        <Field label="Until" id="audit-to" type="date" value={params.get("to") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "to", event.target.value))} />
        {params.get("actor") === null ? null : (
          <p className="self-center text-sm text-ink-soft">
            One person's changes.{" "}
            <button className="font-medium text-accent underline underline-offset-2" type="button" onClick={() => setParams(CatalogParams.set(params, "actor", ""))}>
              Show everyone's
            </button>
          </p>
        )}
      </form>

      {match(events)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-96 w-full" />)
        .when(
          ({ data }) => data.items.length === 0,
          () => <EmptyState title="Nothing in the log matches." />,
        )
        .otherwise(({ data }) => (
          <>
            <DataTable
              label="Audit log"
              rows={data.items}
              rowKey={(event) => String(event.id)}
              columns={[
                { key: "at", header: "When", cell: (event) => <span className="whitespace-nowrap">{OrderTime.format(event.at)}</span> },
                {
                  key: "actor",
                  header: "Who",
                  cell: (event) =>
                    event.actor === undefined ? (
                      <span className="text-ink-soft">The shop itself</span>
                    ) : (
                      <span className="block min-w-40">
                        <Link className="break-all text-accent underline-offset-2 hover:underline" to={`/admin/audit?actor=${event.actor.id}`}>
                          {event.actor.email}
                        </Link>
                        <span className="block text-xs text-ink-soft">{event.actorRoles.map((role) => StaffRole.label[role]).join(", ")}</span>
                      </span>
                    ),
                },
                { key: "action", header: "Action", cell: (event) => <code className="font-mono text-xs text-ink">{event.action}</code> },
                {
                  key: "target",
                  header: "Target",
                  cell: (event) => (
                    <span className="block min-w-32 text-xs">
                      {event.targetType}
                      {event.targetId === undefined ? null : <span className="block break-all text-ink-soft">{event.targetId}</span>}
                    </span>
                  ),
                },
                {
                  key: "summary",
                  header: "What happened",
                  cell: (event) => (
                    <span className="block min-w-56">
                      {event.summary}
                      {event.changes === undefined ? null : (
                        <details className="mt-1 text-xs">
                          <summary className="cursor-pointer text-accent">
                            {Object.keys(event.changes).length === 1 ? "1 field changed" : `${Object.keys(event.changes).length} fields changed`}
                          </summary>
                          <dl className="mt-1 space-y-1">
                            {Object.entries(event.changes).map(([field, [before, after]]) => (
                              <div key={field}>
                                <dt className="font-medium text-ink">{field}</dt>
                                <dd className="break-all text-ink-soft">
                                  {JSON.stringify(before)} → {JSON.stringify(after)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </details>
                      )}
                    </span>
                  ),
                },
                { key: "ip", header: "From", cell: (event) => <span className="font-mono text-xs">{event.ip ?? ""}</span> },
              ]}
            />
            <Pagination page={data.page} totalPages={data.totalPages} label="Log pages" onPage={(page) => setParams(CatalogParams.set(params, "page", String(page)))} />
          </>
        ))}
    </AdminPage>
  );
};
