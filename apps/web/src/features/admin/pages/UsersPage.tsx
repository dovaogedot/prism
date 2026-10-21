import { StaffRole, type AdminUserSummary, type Page } from "@prism/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, DataTable, EmptyState, Field, Pagination, SelectField, Skeleton } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { CatalogParams } from "../../catalog/filters.ts";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/**
 * The shop's accounts: one customer found by their exact email, or the
 * staff, all of them or those holding one role, newest first.
 */
export const UsersPage = () => {
  const [params, setParams] = useSearchParams();

  const query = params.toString();

  const users = useAdminRead<Page<AdminUserSummary>>(AdminKeys.list("users", query), `/users${query.length === 0 ? "" : `?${query}`}`);

  const [email, setEmail] = useState(params.get("email") ?? "");

  return (
    <AdminPage text={PageText.adminUsers} heading="Accounts">
      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams(CatalogParams.set(params, "email", email.trim()));
          }}
        >
          <Field
            label="Exact email"
            id="user-email"
            type="email"
            hint="Emails are stored encrypted, so only an exact address finds an account."
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            action={
              <Button type="submit" tone="quiet">
                Find
              </Button>
            }
          />
        </form>
        <div className="flex flex-wrap items-end gap-5">
          <SelectField label="Staff role" id="user-role" value={params.get("role") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "role", event.target.value))}>
            <option value="">Any account</option>
            {StaffRole.NAMES.map((role) => (
              <option key={role} value={role}>
                {StaffRole.label[role]}
              </option>
            ))}
          </SelectField>
          <label className="flex items-center gap-2 pb-3 text-sm text-ink">
            <input
              className="size-4 accent-[var(--color-accent)]"
              type="checkbox"
              checked={params.get("staff") === "true"}
              onChange={(event) => setParams(CatalogParams.set(params, "staff", event.target.checked ? "true" : ""))}
            />
            Staff only
          </label>
        </div>
      </div>

      {match(users)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-96 w-full" />)
        .when(
          ({ data }) => data.items.length === 0,
          () => <EmptyState title="No account matches." />,
        )
        .otherwise(({ data }) => (
          <>
            <DataTable
              label="Accounts"
              rows={data.items}
              rowKey={(user) => user.id}
              columns={[
                {
                  key: "email",
                  header: "Email",
                  cell: (user) => (
                    <Link className="break-all font-medium text-accent underline-offset-2 hover:underline" to={`/admin/users/${user.id}`}>
                      {user.email}
                    </Link>
                  ),
                },
                { key: "roles", header: "Staff roles", cell: (user) => (user.roles.length === 0 ? "Customer" : user.roles.map((role) => StaffRole.label[role]).join(", ")) },
                { key: "2fa", header: "2FA", cell: (user) => (user.twoFactorEnabled ? "On" : "Off") },
                { key: "status", header: "Status", cell: (user) => (user.disabledAt === undefined ? "Active" : <span className="font-medium text-danger">Disabled</span>) },
                { key: "joined", header: "Joined", cell: (user) => <span className="whitespace-nowrap">{OrderTime.day(user.createdAt)}</span> },
              ]}
            />
            <Pagination page={data.page} totalPages={data.totalPages} label="Account pages" onPage={(page) => setParams(CatalogParams.set(params, "page", String(page)))} />
          </>
        ))}
    </AdminPage>
  );
};
