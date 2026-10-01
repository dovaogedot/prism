import { OrderStatus, type OrderEvent } from "@prism/shared";
import { OrderTime } from "../orders.ts";

/** The order's history, oldest first. */
export type OrderTimelineProps = Readonly<{ events: readonly OrderEvent[] }>;

/** Every status the order reached, with when, and a note where the status alone does not say enough. */
export const OrderTimeline = ({ events }: OrderTimelineProps) => (
  <ol className="relative space-y-4 border-l border-line pl-5">
    {events.map((event, index) => (
      <li key={`${event.at}:${index}`} className="relative">
        <span
          aria-hidden="true"
          className={`absolute -left-[1.6rem] top-1 size-2.5 rounded-full ${
            index === events.length - 1 ? "bg-accent" : "bg-line-strong"
          }`}
        />
        <p className="text-sm font-medium text-ink">{event.note ?? OrderStatus.label[event.status]}</p>
        <p className="text-xs text-ink-faint">
          {event.note === undefined ? "" : `${OrderStatus.label[event.status]} · `}
          <time dateTime={event.at}>{OrderTime.format(event.at)}</time>
        </p>
      </li>
    ))}
  </ol>
);
