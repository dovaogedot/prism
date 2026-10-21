import { OrderStatus } from "@prism/shared";

/** The status to show. */
export type StatusBadgeProps = Readonly<{ status: OrderStatus }>;

const Tones = {
  pending_payment: "border-warn/40 text-warn",
  payment_successful: "border-accent/40 text-accent",
  payment_failed: "border-danger/40 text-danger",
  processing: "border-accent/40 text-accent",
  shipped: "border-accent/40 text-accent",
  delivered: "border-line-strong text-ink",
  canceled: "border-line text-ink-faint",
  refunded: "border-line text-ink-faint",
} as const satisfies Record<OrderStatus, string>;

/** An order's status as a small outlined label, colored by how it went. */
export const StatusBadge = ({ status }: StatusBadgeProps) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${Tones[status]}`}>
    {OrderStatus.label[status]}
  </span>
);
