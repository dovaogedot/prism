import { StaffRole, type AdminUserSummary, type Page } from "@prism/shared"
import { Link, useSearchParams } from "react-router"
import { match, P } from "ts-pattern"
import { Api } from "../../../shared/api/client.ts"
import { PageText } from "../../../shared/seo/page-text.ts"
import { Alert, Button, DataTable, EmptyState, Field, Pagination, SelectField, Skeleton } from "../../../shared/ui/index.ts"
import { Failure } from "../../../shared/api/failure.tsx"
import { useAdminRead, useParamDraft } from "../admin.ts"
import { AdminPage } from "../components/index.ts"
import { DateTime } from "../../../shared/format/date-time.ts"
import { UrlParams } from "../../../shared/url/url-params.ts"

/**
 * The shop's accounts: one customer found by their exact email, or the
 * staff, all of them or those holding one role, newest first.
 */
export const UsersPage = () => {
  const [params, setParams] = useSearchParams()

  /** Filters or sorts in place, so the page keeps its scroll. */
  const filter = (next: URLSearchParams): void => {
    setParams(next, { preventScrollReset: true })
  }

  const query = params.toString()

  const users = useAdminRead<Page<AdminUserSummary>>(Api.withQuery("/users", query))

  const [email, setEmail] = useParamDraft(params, "email")

  return (
    <AdminPage text={PageText.adminUsers} heading="Accounts">
      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            filter(UrlParams.set(params, "email", email.trim()))
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
          <SelectField
            label="Staff role"
            id="user-role"
            value={params.get("role") ?? ""}
            onChange={(event) => filter(UrlParams.set(params, "role", event.target.value))}
          >
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
              onChange={(event) => filter(UrlParams.set(params, "staff", event.target.checked ? "true" : ""))}
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
                {
                  key: "roles",
                  header: "Staff roles",
                  cell: (user) => (user.roles.length === 0 ? "Customer" : user.roles.map((role) => StaffRole.label[role]).join(", ")),
                },
                { key: "2fa", header: "2FA", cell: (user) => (user.twoFactorEnabled ? "On" : "Off") },
                {
                  key: "status",
                  header: "Status",
                  cell: (user) => (user.disabledAt === undefined ? "Active" : <span className="font-medium text-danger">Disabled</span>),
                },
                {
                  key: "joined",
                  header: "Joined",
                  cell: (user) => <span className="whitespace-nowrap">{DateTime.day(user.createdAt)}</span>,
                },
              ]}
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              label="Account pages"
              onPage={(page) => setParams(UrlParams.set(params, "page", String(page)))}
            />
          </>
        ))}
    </AdminPage>
  )
}
