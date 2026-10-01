import { Price, type OrderSummary } from "@prism/shared";
import { Link } from "react-router";
import { Picture } from "../../catalog/components/ProductCard.tsx";
import { OrderTime } from "../orders.ts";
import { StatusBadge } from "./StatusBadge.tsx";

/** The order to show. */
export type OrderRowProps = Readonly<{ order: OrderSummary }>;

/** One order in the list: its picture, number, date, size, total and status, all one link. */
export const OrderRow = ({ order }: OrderRowProps) => (
  <li>
    <Link
      to={`/orders/${order.id}`}
      className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong sm:gap-4"
    >
      <Picture image={order.image} name={`#${order.number}`} className="size-14 shrink-0 rounded-lg" />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">Order #{order.number}</p>
        <p className="text-sm text-ink-soft">
          <time dateTime={order.createdAt}>{OrderTime.day(order.createdAt)}</time> · {order.itemCount} item
          {order.itemCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <span className="text-sm font-semibold tabular-nums text-ink">{Price.format(order.totalCents)}</span>
        <StatusBadge status={order.status} />
      </div>
    </Link>
  </li>
);
