/**
 * Every exchange, routing key and queue the shop uses. The payment service
 * publishes payment outcomes for the order service; the order service
 * publishes cancellations for the payment service. Anything that keeps
 * failing ends up in `dead-letter`, which nothing consumes and the RabbitMQ
 * management UI shows.
 */

import type { Topology as QueueTopology } from "../platform/queue.ts";

export const Topology = {
  PAYMENTS_EXCHANGE: "payments",
  ORDERS_EXCHANGE: "orders",
  DEAD_LETTER_EXCHANGE: "dead-letter",

  PAYMENT_STATUS_KEY: "payment.status",
  ORDER_CANCELED_KEY: "order.canceled",

  /** Consumed by the order service. */
  PAYMENT_STATUS_QUEUE: "orders.payment-status",
  /** Consumed by the payment service. */
  ORDER_CANCELED_QUEUE: "payments.order-canceled",
  DEAD_LETTER_QUEUE: "dead-letter",

  /** How many times a message may be returned before it is dead-lettered. */
  DELIVERY_LIMIT: 5,

  /** The declarations the broker is set up with on every connect. */
  declarations: (): QueueTopology => ({
    exchanges: [
      { name: Topology.PAYMENTS_EXCHANGE, type: "topic" },
      { name: Topology.ORDERS_EXCHANGE, type: "topic" },
      { name: Topology.DEAD_LETTER_EXCHANGE, type: "fanout" },
    ],
    queues: [
      {
        name: Topology.PAYMENT_STATUS_QUEUE,
        exchange: Topology.PAYMENTS_EXCHANGE,
        routingKey: Topology.PAYMENT_STATUS_KEY,
        deadLetterExchange: Topology.DEAD_LETTER_EXCHANGE,
        deliveryLimit: Topology.DELIVERY_LIMIT,
      },
      {
        name: Topology.ORDER_CANCELED_QUEUE,
        exchange: Topology.ORDERS_EXCHANGE,
        routingKey: Topology.ORDER_CANCELED_KEY,
        deadLetterExchange: Topology.DEAD_LETTER_EXCHANGE,
        deliveryLimit: Topology.DELIVERY_LIMIT,
      },
      { name: Topology.DEAD_LETTER_QUEUE, exchange: Topology.DEAD_LETTER_EXCHANGE, routingKey: "#" },
    ],
  }),
} as const;
