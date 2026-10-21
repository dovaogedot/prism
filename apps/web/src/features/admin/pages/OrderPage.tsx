import { Country, Permission, Price, TrackingNumber, type AdminOrderDetail, type OrderStatusChange } from "@prism/shared";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { DeliveryDates } from "../../../shared/format/delivery-dates.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, Card, ConfirmDialog, Field, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useSession } from "../../auth/session.ts";
import { OrderTimeline } from "../../orders/components/OrderTimeline.tsx";
import { StatusBadge } from "../../orders/components/StatusBadge.tsx";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/** Which confirmation is open. */
type Confirming = "none" | "cancel" | "refund";

/**
 * One order for staff: its next step of fulfillment, canceling it before it
 * ships and refunding it after, each as the staff member's roles allow; and
 * everything about it, from the lines to the payment and its history.
 */
export const OrderPage = () => {
  const { id = "" } = useParams();

  const session = useSession();

  const order = useAdminRead<AdminOrderDetail>(AdminKeys.one("orders", id), `/orders/${id}`);

  const [tracking, setTracking] = useState("");

  const [trackingError, setTrackingError] = useState<string | undefined>(undefined);

  const [confirming, setConfirming] = useState<Confirming>("none");

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const advance = useAdminWrite((change: OrderStatusChange) => Api.post<AdminOrderDetail>(`/admin/orders/${id}/status`, change));

  const cancel = useAdminWrite(() => Api.post<AdminOrderDetail>(`/admin/orders/${id}/cancel`));

  const refund = useAdminWrite(() => Api.post<AdminOrderDetail>(`/admin/orders/${id}/refund`));

  const roles = session?.roles ?? [];
  const canFulfill = Permission.can(roles, "orders.fulfill");
  const canRefund = Permission.can(roles, "orders.refund");

  const done = (message: string) => () => {
    setConfirming("none");
    Toast.show(message);
  };
  const refused = (reason: unknown): void => {
    setConfirming("none");
    setFailure(Failure.message(reason));
  };

  return match(order)
    .with({ status: "error" }, ({ error }) => (
      <AdminPage text={PageText.adminOrder} heading="Order not found">
        <Alert>{Failure.message(error)}</Alert>
      </AdminPage>
    ))
    .with({ data: P.nullish }, () => (
      <AdminPage text={PageText.adminOrder} heading="Order">
        <Skeleton className="h-96 w-full" />
      </AdminPage>
    ))
    .otherwise(({ data }) => (
      <AdminPage text={{ ...PageText.adminOrder, title: `Order #${data.number} - Admin` }} heading={`Order #${data.number}`} actions={<StatusBadge status={data.status} />}>
        {failure === undefined ? null : <Alert>{failure}</Alert>}

        <Card className="space-y-4 p-5">
          <h2 className="font-semibold text-ink">Next step</h2>
          {match({ next: data.nextStatus, canFulfill })
            .with({ canFulfill: false }, () => <p className="text-sm text-ink-soft">Moving orders along needs the delivery manager role.</p>)
            .with({ next: P.nullish }, () => <p className="text-sm text-ink-soft">Nothing follows: the order is {data.status.replaceAll("_", " ")}.</p>)
            .with({ next: "processing" }, () => (
              <Button busy={advance.isPending} onClick={() => advance.mutate({ status: "processing" }, { onSuccess: done("The order is being processed."), onError: refused })}>
                Start processing
              </Button>
            ))
            .with({ next: "shipped" }, () => (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  const parsed = TrackingNumber.schema.safeParse(tracking);
                  if (!parsed.success) {
                    setTrackingError(parsed.error.issues[0]?.message);
                    return;
                  }
                  setTrackingError(undefined);
                  advance.mutate({ status: "shipped", trackingNumber: parsed.data }, { onSuccess: done("The order is shipped, and the customer is told."), onError: refused });
                }}
                noValidate
              >
                <Field label="Tracking number" id="tracking" value={tracking} error={trackingError} onChange={(event) => setTracking(event.target.value)} />
                <Button type="submit" busy={advance.isPending}>
                  Mark shipped
                </Button>
              </form>
            ))
            .with({ next: "delivered" }, () => (
              <Button busy={advance.isPending} onClick={() => advance.mutate({ status: "delivered" }, { onSuccess: done("The order is delivered."), onError: refused })}>
                Mark delivered
              </Button>
            ))
            .exhaustive()}

          {canRefund && (data.canCancel || data.canRefund) ? (
            <div className="flex flex-wrap gap-2 border-t border-line pt-4">
              {data.canCancel ? (
                <Button tone="danger" onClick={() => setConfirming("cancel")}>
                  Cancel order
                </Button>
              ) : null}
              {data.canRefund ? (
                <Button tone="danger" onClick={() => setConfirming("refund")}>
                  Refund in full
                </Button>
              ) : null}
            </div>
          ) : null}
        </Card>

        <div className="grid gap-6 xl:grid-cols-[1fr_20rem] xl:items-start">
          <div className="space-y-6">
            <Card className="p-5">
              <h2 className="mb-2 font-semibold text-ink">Items</h2>
              <ul className="divide-y divide-line text-sm">
                {data.lines.map((line) => (
                  <li className="flex items-baseline justify-between gap-4 py-2" key={`${line.slug}:${line.name}`}>
                    <span className="min-w-0">
                      <span className="text-ink">{line.name}</span>
                      <span className="text-ink-soft">
                        {" "}
                        · {line.quantity} × {Price.format(line.unitPriceCents)}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink">{Price.format(line.lineTotalCents)}</span>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 space-y-1 border-t border-line pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Subtotal</dt>
                  <dd className="tabular-nums">{Price.format(data.subtotalCents)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-soft">Shipping ({data.shippingMethodName})</dt>
                  <dd className="tabular-nums">{Price.format(data.shippingCents)}</dd>
                </div>
                <div className="flex justify-between font-semibold">
                  <dt>Total</dt>
                  <dd className="tabular-nums">{Price.format(data.totalCents)}</dd>
                </div>
              </dl>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 font-semibold text-ink">History</h2>
              <OrderTimeline events={data.events} />
            </Card>
          </div>

          <div className="space-y-6 text-sm">
            <Card className="space-y-1 p-5">
              <h2 className="mb-2 font-semibold text-ink">Customer</h2>
              <p className="text-ink">{data.contact.fullName}</p>
              <p className="break-all text-ink-soft">{data.contact.email}</p>
              <p className="text-ink-soft">{data.contact.phone}</p>
              <p className="pt-1 text-ink-soft">Placed {OrderTime.format(data.createdAt)}</p>
              {data.userId === undefined ? (
                <p className="text-ink-soft">Placed as a guest.</p>
              ) : Permission.can(roles, "customers.view") ? (
                <Link className="font-medium text-accent underline underline-offset-2" to={`/admin/users/${data.userId}`}>
                  Open the account
                </Link>
              ) : null}
            </Card>

            <Card className="space-y-1 p-5">
              <h2 className="mb-2 font-semibold text-ink">Delivery</h2>
              <p className="text-ink">{data.shippingMethodName}</p>
              <p className="text-ink-soft">Expected {DeliveryDates.format(data.estimatedDelivery)}</p>
              {data.trackingNumber === undefined ? null : <p className="font-mono text-ink">{data.trackingNumber}</p>}
              <p className="pt-2 text-ink">{data.address.line1}</p>
              {data.address.line2 === undefined ? null : <p className="text-ink-soft">{data.address.line2}</p>}
              <p className="text-ink-soft">
                {data.address.postalCode} {data.address.city}, {Country.name[data.address.country]}
              </p>
            </Card>

            {data.billingAddress === undefined ? null : (
              <Card className="space-y-1 p-5">
                <h2 className="mb-2 font-semibold text-ink">Billing address</h2>
                <p className="text-ink">{data.billingAddress.line1}</p>
                {data.billingAddress.line2 === undefined ? null : <p className="text-ink-soft">{data.billingAddress.line2}</p>}
                <p className="text-ink-soft">
                  {data.billingAddress.postalCode} {data.billingAddress.city}, {Country.name[data.billingAddress.country]}
                </p>
              </Card>
            )}

            <Card className="space-y-1 p-5">
              <h2 className="mb-2 font-semibold text-ink">Payment</h2>
              {match(data.payment)
                .with(undefined, () => <p className="text-ink-soft">No payment was started.</p>)
                .otherwise((payment) => (
                  <>
                    <p className="capitalize text-ink">{payment.status}</p>
                    {payment.card === undefined ? null : (
                      <p className="text-ink-soft">
                        {payment.card.brand.toUpperCase()} •••• {payment.card.last4}
                      </p>
                    )}
                    {payment.reference === undefined ? null : <p className="break-all font-mono text-xs text-ink-soft">{payment.reference}</p>}
                    {payment.refund === undefined ? null : <p className="text-ink-soft">Refund {payment.refund}</p>}
                  </>
                ))}
            </Card>
          </div>
        </div>

        <ConfirmDialog
          isOpen={confirming === "cancel"}
          title={`Cancel order #${data.number}?`}
          confirmLabel="Cancel order"
          isBusy={cancel.isPending}
          onCancel={() => setConfirming("none")}
          onConfirm={() => cancel.mutate(undefined, { onSuccess: done("The order is canceled, and its payment refunded."), onError: refused })}
        >
          The items go back into stock, any payment is refunded in full, and the customer is told by email.
        </ConfirmDialog>
        <ConfirmDialog
          isOpen={confirming === "refund"}
          title={`Refund order #${data.number} in full?`}
          confirmLabel="Refund in full"
          isBusy={refund.isPending}
          onCancel={() => setConfirming("none")}
          onConfirm={() => refund.mutate(undefined, { onSuccess: done("The refund is on its way to the customer."), onError: refused })}
        >
          {Price.format(data.totalCents)} goes back to the card it was paid with. The stock stays as it is.
        </ConfirmDialog>
      </AdminPage>
    ));
};
