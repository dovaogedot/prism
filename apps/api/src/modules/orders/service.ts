/**
 * The order service: placing an order, reading and canceling it, and
 * following it through payment and fulfillment. It asks the payment service
 * for a charge directly, and learns how the payment went from the queue.
 */

import { randomInt, timingSafeEqual } from "node:crypto";
import {
  AddressCheck,
  Cart,
  OrderKey,
  OrderStatus,
  PaymentFailure,
  Pricing,
  type CheckoutPrefill,
  type DomainError,
  type OrderDetail,
  type OrderId,
  type OrderList,
  type OrderQueryParams,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type ShippingAddress,
  type UserId,
} from "@prism/shared";
import { err, errAsync, ok, ResultAsync, type Result } from "neverthrow";
import type { CartId } from "../../db/ids.ts";
import { Messages, type PaymentStatusChanged } from "../../messaging/messages.ts";
import type { AddressVerifier } from "../../platform/address-verifier.ts";
import { Clock } from "../../platform/clock.ts";
import type { Mailer, OutboundEmail } from "../../platform/mailer.ts";
import { OpaqueToken } from "../../platform/tokens.ts";
import type { AuthRepository } from "../auth/repository.ts";
import type { CartRepository } from "../cart/repository.ts";
import type { PaymentService } from "../payments/service.ts";
import { OrderEmail } from "./emails.ts";
import type { OrderRecord, OrderRepository, OrderTransition } from "./repository.ts";

/** Who is asking for an order: its owner, or a guest holding its key. */
export type OrderAccess = Readonly<{ userId?: UserId; key?: OrderKey }>;

/** The ports the order service works through. */
export type OrderDependencies = Readonly<{
  repository: OrderRepository;
  carts: CartRepository;
  users: AuthRepository;
  payments: PaymentService;
  /** False when no payment provider is configured. */
  paymentsAvailable: boolean;
  verifier: AddressVerifier;
  mailer: Mailer;
  clock: Clock;
  /** Asks the outbox relay to publish soon. */
  kick: () => void;
  webOrigin: string;
  paymentWindowSeconds: number;
  /** Left out when the simulated fulfillment is off. */
  fulfillmentStepSeconds?: number;
}>;

/** Everything the order service offers. */
export type OrderService = Readonly<{
  verifyAddress: (address: ShippingAddress) => Promise<AddressCheck>;
  /** Places the order from the caller's cart and starts its payment. */
  place: (input: Readonly<{
    cartId?: CartId;
    userId?: UserId;
    body: PlaceOrderInput;
  }>) => ResultAsync<PlaceOrderResult, DomainError>;
  list: (userId: UserId, query: OrderQueryParams) => Promise<OrderList>;
  /** A missing order and someone else's answer alike, so ids cannot be probed. */
  detail: (orderId: OrderId, access: OrderAccess) => ResultAsync<OrderDetail, DomainError>;
  cancel: (orderId: OrderId, access: OrderAccess) => ResultAsync<OrderDetail, DomainError>;
  prefill: (userId: UserId) => ResultAsync<CheckoutPrefill, DomainError>;
  /** Consumes `payment.status`. */
  onPaymentStatus: (message: PaymentStatusChanged) => Promise<void>;
  /** Cancels every unpaid order past its window. Resolves to how many. */
  expireOverdue: () => Promise<number>;
  /** Moves every order that waited one step long enough one step on. Resolves to how many. */
  advanceFulfillment: () => Promise<number>;
}>;

export const OrderService = {
  /** Why an order was canceled: the timeline note, and the sentence its email opens with. */
  CANCELED_BY_CUSTOMER: { note: "Canceled by the customer", email: "You canceled this order." },
  PAYMENT_EXPIRED: {
    note: "Payment window expired",
    email: "We did not receive the payment in time, so the order was canceled and its items went back on sale.",
  },

  /** The simulated warehouse: each status and the one after it. */
  FULFILLMENT: [
    { from: "payment_successful", to: "processing" },
    { from: "processing", to: "shipped" },
    { from: "shipped", to: "delivered" },
  ] as const satisfies readonly Readonly<{ from: OrderStatus; to: OrderStatus }>[],

  /** A carrier-looking tracking number. */
  trackingNumber: (): string => `PR${String(randomInt(0, 1_000_000_000)).padStart(9, "0")}EE`,

  /** Compares keys in constant time, so the comparison leaks nothing about the stored key. */
  keysMatch: (stored: OrderKey, presented: OrderKey): boolean => {
    const a = Buffer.from(stored);
    const b = Buffer.from(presented);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  /** Whether `access` may see `order`. */
  canAccess: (order: OrderRecord, access: OrderAccess): boolean => {
    if (order.userId !== undefined && access.userId === order.userId) return true;
    return order.key !== undefined && access.key !== undefined && OrderService.keysMatch(order.key, access.key);
  },

  create: (deps: OrderDependencies): OrderService => {
    const { repository, clock, mailer } = deps;
    const notFound: DomainError = { _tag: "OrderNotFound" };

    const urlOf = (order: OrderRecord): string => OrderEmail.urlOf(deps.webOrigin, order);

    /** Sends an email about an order as it now stands. */
    const notify = async (orderId: OrderId, compose: (order: OrderRecord, url: string) => OutboundEmail) => {
      const order = await repository.find(orderId);
      if (order !== undefined) await mailer.send(compose(order, urlOf(order)));
    };

    const move = async (transition: OrderTransition): Promise<boolean> => {
      const moved = await repository.transition(transition);
      if (moved && transition.message !== undefined) deps.kick();
      return moved;
    };

    const accessible = (orderId: OrderId, access: OrderAccess): ResultAsync<OrderRecord, DomainError> =>
      ResultAsync.fromSafePromise(repository.find(orderId)).andThen((order) =>
        order !== undefined && OrderService.canAccess(order, access) ? ok(order) : err(notFound),
      );

    const detailOf = async (order: OrderRecord): Promise<OrderDetail> => {
      const [events, payment] = await Promise.all([repository.events(order.id), deps.payments.summaryOf(order.id)]);

      return {
        id: order.id,
        number: order.number,
        status: order.status,
        createdAt: order.createdAt.toISOString(),
        contact: order.contact,
        address: order.address,
        shippingMethod: order.shippingMethod,
        lines: order.lines,
        subtotalCents: order.subtotalCents,
        shippingCents: order.shippingCents,
        totalCents: order.totalCents,
        events,
        ...(payment === undefined ? {} : { payment }),
        ...(order.trackingNumber === undefined ? {} : { trackingNumber: order.trackingNumber }),
        cancelable: OrderStatus.isCancelable(order.status),
        ...(order.status === "pending_payment" ? { paymentDueAt: order.paymentDueAt.toISOString() } : {}),
      };
    };

    /** Cancels an order from one of `from`, giving the stock back and telling the payment service. */
    const cancelFrom = async (
      orderId: OrderId,
      from: readonly OrderStatus[],
      reason: Readonly<{ note: string; email: string }>,
    ): Promise<boolean> => {
      const moved = await move({
        orderId,
        from,
        to: "canceled",
        note: reason.note,
        now: clock.now(),
        releaseStock: true,
        message: Messages.orderCanceled({ orderId }),
      });

      if (moved) await notify(orderId, (order, url) => OrderEmail.canceled(order, url, reason.email));
      return moved;
    };

    const verifyAddress = async (address: ShippingAddress): Promise<AddressCheck> => ({
      status: await deps.verifier.verify(address),
    });

    const place = async (input: Parameters<OrderService["place"]>[0]): Promise<Result<PlaceOrderResult, DomainError>> => {
      if (!deps.paymentsAvailable) return err({ _tag: "PaymentsUnavailable" });
      if (input.cartId === undefined) return err({ _tag: "CartEmpty" });

      const { body } = input;
      const view = await deps.carts.view(input.cartId);
      if (view.lines.length === 0) return err({ _tag: "CartEmpty" });

      const issues = Cart.issues(view.lines);
      if (issues.length > 0) return err({ _tag: "OutOfStock", issues });

      // The server prices the order itself; the browser's total only proves
      // the customer saw the same number.
      const totals = Pricing.totals(view.lines, body.shippingMethod);
      if (totals.totalCents !== body.expectedTotalCents) return err({ _tag: "CartChanged" });

      if ((await deps.verifier.verify(body.address)) === "not_found") {
        return err({ _tag: "ValidationFailed", issues: [{ path: "address.line1", message: AddressCheck.NOT_FOUND }] });
      }

      const key = input.userId === undefined ? OpaqueToken.create(OrderKey.schema).plaintext : undefined;
      const now = clock.now();

      const placed = await repository.place({
        cartId: input.cartId,
        ...(input.userId === undefined ? {} : { userId: input.userId }),
        contact: body.contact,
        address: body.address,
        shippingMethod: body.shippingMethod,
        lines: view.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
        totals,
        ...(key === undefined ? {} : { key }),
        now,
        paymentDueAt: Clock.after(clock, deps.paymentWindowSeconds),
      });

      if (placed._tag === "Short") return err({ _tag: "OutOfStock", issues: placed.issues });
      if (placed._tag === "PriceChanged") return err({ _tag: "CartChanged" });

      const charge = await deps.payments.startCharge({ orderId: placed.orderId, amountCents: totals.totalCents });
      if (charge.isErr()) return err(charge.error);

      return ok({
        orderId: placed.orderId,
        number: placed.number,
        ...(key === undefined ? {} : { key }),
        clientSecret: charge.value,
      });
    };

    return {
      verifyAddress,

      place: (input) => new ResultAsync(place(input)),

      list: (userId, query) =>
        repository.list(userId, {
          statuses: query.status ?? [],
          ...(query.from === undefined ? {} : { from: query.from }),
          ...(query.to === undefined ? {} : { to: query.to }),
          sort: query.sort,
          page: query.page,
          perPage: query.perPage,
        }),

      detail: (orderId, access) =>
        accessible(orderId, access).andThen((order) => ResultAsync.fromSafePromise(detailOf(order))),

      cancel: (orderId, access) =>
        accessible(orderId, access)
          .andThen((order) =>
            ResultAsync.fromSafePromise(cancelFrom(order.id, OrderStatus.CANCELABLE, OrderService.CANCELED_BY_CUSTOMER)),
          )
          .andThen((canceled) =>
            canceled ? accessible(orderId, access) : errAsync<OrderRecord, DomainError>({ _tag: "OrderNotCancelable" }),
          )
          .andThen((order) => ResultAsync.fromSafePromise(detailOf(order))),

      prefill: (userId) =>
        ResultAsync.fromSafePromise(Promise.all([deps.users.findUserById(userId), repository.latestOf(userId)])).andThen(
          ([user, latest]) => {
            if (user === undefined) return err<CheckoutPrefill, DomainError>({ _tag: "Unauthenticated" });

            return ok<CheckoutPrefill, DomainError>({
              email: user.email,
              ...(latest === undefined
                ? {}
                : { contact: latest.contact, address: latest.address, shippingMethod: latest.shippingMethod }),
            });
          },
        ),

      onPaymentStatus: async (message) => {
        const { orderId } = message;

        switch (message.outcome) {
          case "succeeded": {
            const moved = await move({
              orderId,
              from: ["pending_payment"],
              to: "payment_successful",
              now: clock.now(),
              clearFromCart: true,
            });

            if (moved) {
              await notify(orderId, OrderEmail.confirmed);
              return;
            }

            // Paid after it was canceled or failed: the money goes back.
            const order = await repository.find(orderId);
            if (order !== undefined && (order.status === "canceled" || order.status === "payment_failed")) {
              await repository.announce(Messages.orderCanceled({ orderId }));
              deps.kick();
            }
            return;
          }

          case "failed": {
            const moved = await move({
              orderId,
              from: ["pending_payment"],
              to: "payment_failed",
              ...(message.failure === undefined ? {} : { note: PaymentFailure.message[message.failure] }),
              now: clock.now(),
              releaseStock: true,
            });

            if (moved) await notify(orderId, (order, url) => OrderEmail.paymentFailed(order, url, message.failure));
            return;
          }

          case "refunded": {
            if (await repository.markRefunded(orderId, clock.now())) await notify(orderId, OrderEmail.refunded);
            return;
          }
        }
      },

      expireOverdue: async () => {
        let expired = 0;

        for (const orderId of await repository.overdue(clock.now())) {
          if (await cancelFrom(orderId, ["pending_payment"], OrderService.PAYMENT_EXPIRED)) expired += 1;
        }

        return expired;
      },

      advanceFulfillment: async () => {
        const step = deps.fulfillmentStepSeconds;
        if (step === undefined) return 0;

        const before = Clock.after(clock, -step);
        let advanced = 0;

        for (const { from, to } of OrderService.FULFILLMENT) {
          for (const orderId of await repository.stale(from, before)) {
            const trackingNumber = to === "shipped" ? OrderService.trackingNumber() : undefined;
            const moved = await move({
              orderId,
              from: [from],
              to,
              now: clock.now(),
              ...(trackingNumber === undefined ? {} : { trackingNumber }),
            });

            if (!moved) continue;

            advanced += 1;
            if (trackingNumber !== undefined) {
              await notify(orderId, (order, url) => OrderEmail.shipped(order, url, trackingNumber));
            }
          }
        }

        return advanced;
      },
    };
  },
} as const;
