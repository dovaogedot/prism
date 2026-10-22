import { Delivery, Permission, type AdminSummary } from "@prism/shared";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Card } from "../../../shared/ui/index.ts";
import { useSession } from "../../auth/session.ts";
import { AdminKeys } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/** One count on the dashboard, and the list it leads to. */
type Tile = Readonly<{ label: string; value: number; href: string }>;

/**
 * Where the admin opens: what waits for this staff member's roles, as
 * counts that lead to the lists, and what the roles allow.
 */
export const DashboardPage = () => {
  const session = useSession();

  const summary = useQuery({
    queryKey: AdminKeys.summary,
    queryFn: ({ signal }) => Api.get<AdminSummary>("/admin/summary", signal),
  });

  const roles = session?.roles ?? [];
  const counts = summary.data ?? {};
  const today = Delivery.dayOf(new Date());
  const tiles: readonly Tile[] = [
    ...(counts.ordersToFulfill === undefined
      ? []
      : [{ label: "Orders to fulfill", value: counts.ordersToFulfill, href: "/admin/orders?status=payment_successful&status=processing&sort=oldest" }]),
    ...(counts.paidToday === undefined ? [] : [{ label: "Paid today", value: counts.paidToday, href: `/admin/orders?from=${today}&to=${today}` }]),
    ...(counts.reviewsWaiting === undefined ? [] : [{ label: "Reviews waiting", value: counts.reviewsWaiting, href: "/admin/reviews" }]),
    ...(counts.lowStockProducts === undefined ? [] : [{ label: "Low on stock", value: counts.lowStockProducts, href: "/admin/products?lowStock=true&sort=stock_asc" }]),
  ];

  return (
    <AdminPage text={PageText.adminDashboard} heading="Dashboard">
      {tiles.length === 0 ? null : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.label}>
              <Link className="block rounded-lg border border-line bg-surface p-5 transition-colors hover:border-line-strong" to={tile.href}>
                <span className="block text-sm text-ink-soft">{tile.label}</span>
                <span className="mt-1 block text-3xl font-semibold tabular-nums text-ink">{tile.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold text-ink">What your roles allow</h2>
        <ul className="list-inside list-disc space-y-1 text-sm text-ink-soft">
          {Permission.of(roles).map((permission) => (
            <li key={permission}>{Permission.label[permission]}</li>
          ))}
        </ul>
      </Card>
    </AdminPage>
  );
};
