import { Permission, Price, StaffRole, type AdminUserDetail } from "@prism/shared";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, Card, ConfirmDialog, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useSession } from "../../auth/session.ts";
import { StatusBadge } from "../../orders/components/StatusBadge.tsx";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/** One of the account actions only staff managers take, which each ask first. */
type AccountAction = "disable" | "enable" | "reset-two-factor" | "sign-out";

/**
 * One account for staff: who it is, how it signs in, its sessions and
 * recent orders. A staff manager also sets its staff roles, disables or
 * enables it, resets its second factor, and signs it out everywhere; each of
 * those asks first, and the audit log records it.
 */
export const UserPage = () => {
  const { id = "" } = useParams();

  const session = useSession();

  const user = useAdminRead<AdminUserDetail>(AdminKeys.one("users", id), `/users/${id}`);

  const [roles, setRoles] = useState<readonly StaffRole[] | undefined>(undefined);

  const [isConfirmingRoles, setConfirmingRoles] = useState(false);

  const [action, setAction] = useState<AccountAction | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const saveRoles = useAdminWrite((chosen: readonly StaffRole[]) => Api.put<AdminUserDetail>(`/admin/users/${id}/roles`, { roles: chosen }));

  const act = useAdminWrite((chosen: AccountAction) => Api.post<AdminUserDetail>(`/admin/users/${id}/${chosen}`));

  const viewerRoles = session?.roles ?? [];
  const canManage = Permission.can(viewerRoles, "staff.manage");
  const canSeeOrders = Permission.can(viewerRoles, "orders.view");

  const actions = {
    disable: { title: "Disable this account?", label: "Disable account", text: "It cannot sign in, and every session it has ends now.", done: "The account is disabled." },
    enable: { title: "Enable this account?", label: "Enable account", text: "It can sign in again.", done: "The account is enabled." },
    "reset-two-factor": {
      title: "Reset two-factor authentication?",
      label: "Reset 2FA",
      text: "Its second factor is removed. A staff account must set a new one before the admin opens again.",
      done: "Two-factor authentication is reset.",
    },
    "sign-out": { title: "Sign it out everywhere?", label: "Sign out everywhere", text: "Every session ends now; the account can sign in again.", done: "The account is signed out everywhere." },
  } as const satisfies Record<AccountAction, Readonly<{ title: string; label: string; text: string; done: string }>>;

  return match(user)
    .with({ status: "error" }, ({ error }) => (
      <AdminPage text={PageText.adminUser} heading="Account not found">
        <Alert>{Failure.message(error)}</Alert>
      </AdminPage>
    ))
    .with({ data: P.nullish }, () => (
      <AdminPage text={PageText.adminUser} heading="Account">
        <Skeleton className="h-96 w-full" />
      </AdminPage>
    ))
    .otherwise(({ data }) => {
      const chosen = roles ?? data.roles;
      const isChanged = chosen.length !== data.roles.length || chosen.some((role) => !data.roles.includes(role));

      return (
        <AdminPage text={{ ...PageText.adminUser, title: `${data.email} - Admin` }} heading={data.email}>
          {failure === undefined ? null : <Alert>{failure}</Alert>}

          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <Card className="space-y-1 p-5 text-sm">
              <h2 className="mb-2 text-base font-semibold text-ink">The account</h2>
              <p className="text-ink">{data.fullName ?? "No name given"}</p>
              {data.phone === undefined ? null : <p className="text-ink-soft">{data.phone}</p>}
              <p className="text-ink-soft">Joined {OrderTime.format(data.createdAt)}</p>
              <p className="text-ink-soft">
                Signs in with {[...(data.hasPassword ? ["a password"] : []), ...data.providers.map((provider) => provider.charAt(0).toUpperCase() + provider.slice(1))].join(" and ")}
              </p>
              <p className="text-ink-soft">Two-factor authentication {data.twoFactorEnabled ? "on" : "off"}</p>
              <p className="text-ink-soft">{data.liveSessions === 1 ? "1 session signed in" : `${data.liveSessions} sessions signed in`}</p>
              {data.disabledAt === undefined ? null : <p className="font-medium text-danger">Disabled since {OrderTime.format(data.disabledAt)}</p>}
            </Card>

            <Card className="p-5">
              <h2 className="mb-2 font-semibold text-ink">Recent orders</h2>
              {data.orders.length === 0 ? (
                <p className="text-sm text-ink-soft">No orders yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {data.orders.map((order) => (
                    <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={order.id}>
                      {canSeeOrders ? (
                        <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/admin/orders/${order.id}`}>
                          #{order.number}
                        </Link>
                      ) : (
                        <span className="font-medium text-ink">#{order.number}</span>
                      )}
                      <StatusBadge status={order.status} />
                      <span className="tabular-nums text-ink">{Price.format(order.totalCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {canManage ? (
            <>
              <Card className="space-y-4 p-5">
                <h2 className="font-semibold text-ink">Staff roles</h2>
                <fieldset className="space-y-3">
                  <legend className="sr-only">Staff roles</legend>
                  {StaffRole.NAMES.map((role) => (
                    <label className="flex items-start gap-3 text-sm" key={role}>
                      <input
                        className="mt-0.5 size-4 accent-[var(--color-accent)]"
                        type="checkbox"
                        checked={chosen.includes(role)}
                        onChange={(event) => setRoles(event.target.checked ? [...chosen, role] : chosen.filter((held) => held !== role))}
                      />
                      <span>
                        <span className="block font-medium text-ink">{StaffRole.label[role]}</span>
                        <span className="block text-ink-soft">{StaffRole.description[role]}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Button type="button" disabled={!isChanged} onClick={() => setConfirmingRoles(true)}>
                  Save roles
                </Button>
              </Card>

              <Card className="space-y-3 p-5">
                <h2 className="font-semibold text-ink">Account actions</h2>
                <div className="flex flex-wrap gap-2">
                  {data.disabledAt === undefined ? (
                    <Button tone="danger" type="button" onClick={() => setAction("disable")}>
                      Disable account
                    </Button>
                  ) : (
                    <Button tone="quiet" type="button" onClick={() => setAction("enable")}>
                      Enable account
                    </Button>
                  )}
                  {data.twoFactorEnabled ? (
                    <Button tone="quiet" type="button" onClick={() => setAction("reset-two-factor")}>
                      Reset 2FA
                    </Button>
                  ) : null}
                  {data.liveSessions === 0 ? null : (
                    <Button tone="quiet" type="button" onClick={() => setAction("sign-out")}>
                      Sign out everywhere
                    </Button>
                  )}
                </div>
              </Card>
            </>
          ) : null}

          <ConfirmDialog
            isOpen={isConfirmingRoles}
            title="Change the staff roles?"
            confirmLabel="Save roles"
            tone="accent"
            isBusy={saveRoles.isPending}
            onCancel={() => setConfirmingRoles(false)}
            onConfirm={() =>
              saveRoles.mutate(chosen, {
                onSuccess: () => {
                  setConfirmingRoles(false);
                  setRoles(undefined);
                  Toast.show("The roles are saved, and the account holder is told by email.");
                },
                onError: (reason) => {
                  setConfirmingRoles(false);
                  setFailure(Failure.message(reason));
                },
              })
            }
          >
            {chosen.length === 0 ? "The account becomes a customer's again." : `The account holds: ${chosen.map((role) => StaffRole.label[role]).join(", ")}.`} It takes effect on the
            holder's next request.
          </ConfirmDialog>

          <ConfirmDialog
            isOpen={action !== undefined}
            title={action === undefined ? "" : actions[action].title}
            confirmLabel={action === undefined ? "" : actions[action].label}
            isBusy={act.isPending}
            onCancel={() => setAction(undefined)}
            onConfirm={() => {
              if (action === undefined) return;
              act.mutate(action, {
                onSuccess: () => {
                  Toast.show(actions[action].done);
                  setAction(undefined);
                },
                onError: (reason) => {
                  setAction(undefined);
                  setFailure(Failure.message(reason));
                },
              });
            }}
          >
            {action === undefined ? "" : actions[action].text}
          </ConfirmDialog>
        </AdminPage>
      );
    });
};
