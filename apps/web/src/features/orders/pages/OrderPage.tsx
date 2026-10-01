import { Country, OrderStatus, PaymentFailure, Price, ShippingMethod } from "@prism/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Alert, Card, Skeleton } from "../../../shared/ui/index.ts";
import { Picture } from "../../catalog/components/ProductCard.tsx";
import { CancelOrderButton, OrderConfirmation, OrderTimeline, StatusBadge } from "../components/index.ts";
import { OrderPolling, OrderTime, useOrder } from "../orders.ts";

/**
 * One order: its status and history, what is in it, where it goes and how it
 * was paid. Right after checkout it doubles as the confirmation page and
 * watches the order until the payment settles. A guest opens it with the key
 * from the confirmation link.
 */
export const OrderPage = () => {
  const { id = "" } = useParams();

  const [params] = useSearchParams();

  const [startedAt] = useState(() => Date.now());

  const key = params.get("key") ?? undefined;
  const placed = params.get("placed") === "1";

  const order = useOrder(id, key, startedAt);

  const client = useQueryClient();

  const status = order.data?.status;

  // A settled payment takes the bought items out of the cart on the server.
  useEffect(() => {
    if (placed && status !== undefined && status !== "pending_payment") void client.invalidateQueries({ queryKey: ["cart"] });
  }, [placed, status, client]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      {match(order)
        .with({ status: "error" }, () => (
          <Alert title="No such order">We could not find that order. Check the link from your email.</Alert>
        ))
        .with({ data: P.nullish }, () => (
          <div className="space-y-4">
            <Skeleton className="h-10 w-1/2" />
            <Skeleton className="h-64 w-full" />
          </div>
        ))
        .otherwise(({ data }) => (
          <>
            {placed ? (
              <OrderConfirmation order={data} watching={OrderPolling.watching(data.status, startedAt, Date.now())} />
            ) : null}

            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-ink">Order #{data.number}</h1>
                <p className="text-sm text-ink-soft">
                  Placed <time dateTime={data.createdAt}>{OrderTime.format(data.createdAt)}</time>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={data.status} />
                {data.cancelable ? <CancelOrderButton order={data} {...(key === undefined ? {} : { orderKey: key })} /> : null}
              </div>
            </header>

            <div className="grid gap-6 lg:grid-cols-[1fr_20rem] lg:items-start">
              <div className="space-y-6">
                <Card className="p-5">
                  <h2 className="mb-2 text-base font-semibold text-ink">Items</h2>
                  <ul className="divide-y divide-line">
                    {data.lines.map((line) => (
                      <li key={`${line.slug}:${line.name}`} className="flex items-center gap-3 py-3">
                        <Picture image={line.image} name={line.name} className="size-14 shrink-0 rounded-lg border border-line" />
                        <div className="min-w-0 flex-1">
                          {line.productId === undefined ? (
                            <p className="truncate text-sm font-medium text-ink">{line.name}</p>
                          ) : (
                            <Link to={`/item/${line.slug}`} className="truncate text-sm font-medium text-ink hover:text-accent">
                              {line.name}
                            </Link>
                          )}
                          <p className="text-sm tabular-nums text-ink-soft">
                            {line.quantity} × {Price.format(line.unitPriceCents)}
                          </p>
                        </div>
                        <span className="text-sm font-semibold tabular-nums text-ink">{Price.format(line.lineTotalCents)}</span>
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-2 space-y-1.5 border-t border-line pt-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-soft">Subtotal</dt>
                      <dd className="tabular-nums text-ink">{Price.format(data.subtotalCents)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-soft">Shipping ({ShippingMethod.label[data.shippingMethod]})</dt>
                      <dd className="tabular-nums text-ink">{data.shippingCents === 0 ? "Free" : Price.format(data.shippingCents)}</dd>
                    </div>
                    <div className="flex justify-between text-base font-semibold">
                      <dt className="text-ink">Total</dt>
                      <dd className="tabular-nums text-ink">{Price.format(data.totalCents)}</dd>
                    </div>
                  </dl>
                </Card>

                <Card className="p-5">
                  <h2 className="mb-4 text-base font-semibold text-ink">Status updates</h2>
                  <OrderTimeline events={data.events} />
                  {data.trackingNumber === undefined ? null : (
                    <p className="mt-4 text-sm text-ink">
                      Tracking number: <span className="font-mono font-semibold">{data.trackingNumber}</span>
                    </p>
                  )}
                </Card>
              </div>

              <div className="space-y-6">
                <Card className="space-y-1 p-5 text-sm">
                  <h2 className="mb-2 text-base font-semibold text-ink">Shipping to</h2>
                  <p className="font-medium text-ink">{data.contact.fullName}</p>
                  <p className="text-ink-soft">{data.address.line1}</p>
                  {data.address.line2 === undefined ? null : <p className="text-ink-soft">{data.address.line2}</p>}
                  <p className="text-ink-soft">
                    {data.address.postalCode} {data.address.city}
                  </p>
                  <p className="text-ink-soft">{Country.name[data.address.country]}</p>
                  <p className="pt-2 text-ink-soft">{data.contact.email}</p>
                  <p className="text-ink-soft">{data.contact.phone}</p>
                </Card>

                <Card className="space-y-1 p-5 text-sm">
                  <h2 className="mb-2 text-base font-semibold text-ink">Payment</h2>
                  {match(data.payment)
                    .with(P.nullish, () => <p className="text-ink-soft">No payment was started.</p>)
                    .otherwise((payment) => (
                      <>
                        <p className="text-ink">
                          {match(payment.status)
                            .with("pending", () => "Waiting for the payment")
                            .with("succeeded", () => "Paid")
                            .with("failed", () => "Failed")
                            .with("canceled", () => "Not charged")
                            .exhaustive()}
                          {payment.card === undefined ? "" : ` · ${payment.card.brand.toUpperCase()} •••• ${payment.card.last4}`}
                        </p>
                        {payment.failure === undefined ? null : (
                          <p className="text-danger">{PaymentFailure.message[payment.failure]}</p>
                        )}
                        {match(payment.refund)
                          .with(P.nullish, () => null)
                          .with("pending", () => <p className="text-ink-soft">Refund on its way.</p>)
                          .with("succeeded", () => <p className="text-ink-soft">Refunded {Price.format(data.totalCents)}.</p>)
                          .with("failed", () => <p className="text-danger">The refund failed. Contact us and we will sort it out.</p>)
                          .exhaustive()}
                      </>
                    ))}
                </Card>

                {data.status === "pending_payment" && data.paymentDueAt !== undefined && !placed ? (
                  <p className="text-sm text-ink-soft">
                    Unpaid orders are canceled at {OrderTime.format(data.paymentDueAt)}.
                  </p>
                ) : null}

                {OrderStatus.isCancelable(data.status) ? (
                  <p className="text-xs text-ink-faint">You can cancel until the order is being processed.</p>
                ) : null}
              </div>
            </div>
          </>
        ))}
    </div>
  );
};
