import { OrderSort, OrderStatus, Price, type AdminOrderSummary, type Page } from "@prism/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, DataTable, EmptyState, Field, Pagination, SelectField, Skeleton } from "../../../shared/ui/index.ts";
import { CatalogParams } from "../../catalog/filters.ts";
import { StatusBadge } from "../../orders/components/StatusBadge.tsx";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/**
 * Every order, for the staff who handle them: filtered by status, dates,
 * number and email, in the order chosen, a page at a time. The filters live
 * in the URL, which is forwarded to the API as it is.
 */
export const OrdersPage = () => {
  const [params, setParams] = useSearchParams();

  const query = params.toString();

  const orders = useAdminRead<Page<AdminOrderSummary>>(AdminKeys.list("orders", query), `/orders${query.length === 0 ? "" : `?${query}`}`);

  const [number, setNumber] = useState(params.get("number") ?? "");

  const [email, setEmail] = useState(params.get("email") ?? "");

  const statuses = params.getAll("status");

  return (
    <AdminPage text={PageText.adminOrders} heading="Orders">
      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {OrderStatus.NAMES.map((status) => (
            <button
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                statuses.includes(status) ? "border-accent bg-accent-wash text-ink" : "border-line text-ink-soft hover:border-line-strong"
              }`}
              key={status}
              type="button"
              aria-pressed={statuses.includes(status)}
              onClick={() => setParams(CatalogParams.toggle(params, "status", status))}
            >
              {OrderStatus.label[status]}
            </button>
          ))}
        </div>

        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setParams(CatalogParams.set(CatalogParams.set(params, "number", number.trim().replace(/^#/, "")), "email", email.trim()));
          }}
        >
          <Field label="Order number" id="order-number" inputMode="numeric" value={number} onChange={(event) => setNumber(event.target.value)} />
          <Field label="Customer email" id="order-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
          <Field label="Placed from" id="order-from" type="date" value={params.get("from") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "from", event.target.value))} />
          <Field label="Placed until" id="order-to" type="date" value={params.get("to") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "to", event.target.value))} />
          <Button type="submit" tone="quiet">
            Find
          </Button>
        </form>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <SelectField
            label="Sort by"
            id="order-sort"
            value={OrderSort.schema.catch("newest").parse(params.get("sort") ?? "newest")}
            onChange={(event) => setParams(CatalogParams.set(params, "sort", event.target.value))}
          >
            {OrderSort.NAMES.map((sort) => (
              <option key={sort} value={sort}>
                {OrderSort.label[sort]}
              </option>
            ))}
          </SelectField>
          {query.length === 0 ? null : (
            <Button tone="ghost" type="button" onClick={() => setParams(new URLSearchParams())}>
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {match(orders)
        .with({ status: "error" }, ({ error }) => <Alert>{error.message}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-96 w-full" />)
        .when(
          ({ data }) => data.items.length === 0,
          () => <EmptyState title="No orders match these filters." />,
        )
        .otherwise(({ data }) => (
          <>
            <p className="text-sm text-ink-soft">{data.total === 1 ? "1 order" : `${data.total} orders`}</p>
            <DataTable
              label="Orders"
              rows={data.items}
              rowKey={(order) => order.id}
              columns={[
                {
                  key: "number",
                  header: "Order",
                  cell: (order) => (
                    <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/admin/orders/${order.id}`}>
                      #{order.number}
                    </Link>
                  ),
                },
                { key: "placed", header: "Placed", cell: (order) => <span className="whitespace-nowrap">{OrderTime.format(order.createdAt)}</span> },
                {
                  key: "customer",
                  header: "Customer",
                  cell: (order) => (
                    <span className="block min-w-40">
                      <span className="block text-ink">{order.customerName}</span>
                      <span className="block text-xs text-ink-soft">
                        {order.customerEmail}
                        {order.isGuest ? " · guest" : ""}
                      </span>
                    </span>
                  ),
                },
                { key: "status", header: "Status", cell: (order) => <StatusBadge status={order.status} /> },
                { key: "total", header: "Total", isNumeric: true, cell: (order) => Price.format(order.totalCents) },
              ]}
            />
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              label="Order pages"
              onPage={(page) => setParams(CatalogParams.set(params, "page", String(page)))}
            />
          </>
        ))}
    </AdminPage>
  );
};
