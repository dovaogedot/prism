/**
 * The order service: placing an order, reading and canceling it, following
 * it through payment, and the staff's side of it: moving it through
 * fulfillment, canceling it before it ships, and refunding it after. It asks
 * the payment service for a charge directly, learns how the payment went
 * from the queue, and asks for refunds through the queue.
 */

import { timingSafeEqual } from "node:crypto";
import {
  AddressCheck,
  Cart,
  Delivery,
  OrderKey,
  OrderStatus,
  PaymentFailure,
  Pricing,
  type AdminOrderDetail,
  type AdminOrderQuery,
  type AdminOrderSummary,
  type CheckoutPrefill,
  type DomainError,
  type OrderDetail,
  type OrderId,
  type OrderList,
  type OrderQueryParams,
  type OrderStatusChange,
  type Page,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type SavedAddress,
  type SavedAddressInput,
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
import type { ProfileRecord } from "../accounts/repository.ts";
import type { AuthRepository } from "../auth/repository.ts";
import type { CartRepository } from "../cart/repository.ts";
import type { PaymentService } from "../payments/service.ts";
import type { StaffActor } from "../staff/audit.ts";
import { OrderEmail } from "./emails.ts";
import type { OrderRecord, OrderRepository, OrderTransition } from "./repository.ts";
import type { ShippingMethods } from "./shipping.ts";

/** Who is asking for an order: its owner, or a guest holding its key. */
export type OrderAccess = Readonly<{ userId?: UserId; key?: OrderKey }>;

/** What the order service reads and writes of a signed-in customer's account. */
export type CustomerAccounts = Readonly<{
  profileOf: (userId: UserId) => Promise<ProfileRecord | undefined>;
  defaultAddressOf: (userId: UserId) => Promise<SavedAddress | undefined>;
  addresses: (userId: UserId) => Promise<readonly SavedAddress[]>;
  /** Saves an address; one past the limit is not saved, which is no failure of the order. */
  keepAddress: (userId: UserId, input: SavedAddressInput) => Promise<void>;
}>;

/** The ports the order service works through. */
export type OrderDependencies = Readonly<{
  accounts: CustomerAccounts;
  repository: OrderRepository;
  carts: CartRepository;
  users: AuthRepository;
  payments: PaymentService;
  shipping: ShippingMethods;
  /** False when no payment provider is configured. */
  paymentsAvailable: boolean;
  verifier: AddressVerifier;
  mailer: Mailer;
  clock: Clock;
  /** Asks the outbox relay to publish soon. */
  kick: () => void;
  webOrigin: string;
  paymentWindowSeconds: number;
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
  /** Every order, for staff, a page at a time. */
  adminList: (query: AdminOrderQuery) => Promise<Page<AdminOrderSummary>>;
  adminDetail: (orderId: OrderId) => ResultAsync<AdminOrderDetail, DomainError>;
  /** Moves a paid order one step through fulfillment and tells the customer. */
  advance: (actor: StaffActor, orderId: OrderId, change: OrderStatusChange) => ResultAsync<AdminOrderDetail, DomainError>;
  /** Cancels an order that has not shipped: the stock comes back and any payment is refunded. */
  cancelByStaff: (actor: StaffActor, orderId: OrderId) => ResultAsync<AdminOrderDetail, DomainError>;
  /** Refunds a shipped or delivered order in full. The stock stays as it is. */
  refund: (actor: StaffActor, orderId: OrderId) => ResultAsync<AdminOrderDetail, DomainError>;
}>;

export const OrderService = {
  /** Why an order was canceled: the timeline note, and the sentence its email opens with. */
  CANCELED_BY_CUSTOMER: { note: "Canceled by the customer", email: "You canceled this order." },
  CANCELED_BY_SHOP: {
    note: "Canceled by the shop",
    email: "We canceled this order before it shipped. Contact us if you have questions.",
  },
  PAYMENT_EXPIRED: {
    note: "Payment window expired",
    email: "We did not receive the payment in time, so the order was canceled and its items went back on sale.",
  },
  REFUND_REQUESTED_NOTE: "Refund requested by the shop",

  /** Stripe's smallest charge in euros, which every order total has to reach. */
  MINIMUM_TOTAL_CENTS: 50,

  METHOD_UNAVAILABLE: "This shipping method is not available any more. Choose another.",

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

  /** Whether two addresses are the same place, however they were capitalized or spaced. */
  sameAddress: (a: ShippingAddress, b: ShippingAddress): boolean => {
    const key = (address: ShippingAddress) =>
      [address.line1, address.line2 ?? "", address.city, address.postalCode, address.country]
        .map((part) => part.toLowerCase().replace(/\s+/g, " "))
        .join("|");
    return key(a) === key(b);
  },

  /** The step of fulfillment after `status`, when one follows. */
  nextStepOf: (status: OrderStatus): "processing" | "shipped" | "delivered" | undefined => {
    if (status === "payment_successful") return "processing";
    if (status === "processing") return "shipped";
    if (status === "shipped") return "delivered";
    return undefined;
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
        ...(order.billingAddress === undefined ? {} : { billingAddress: order.billingAddress }),
        shippingMethod: order.shippingMethod,
        shippingMethodName: order.shippingMethodName,
        estimatedDelivery: order.estimatedDelivery,
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

    const adminDetailOf = async (order: OrderRecord): Promise<AdminOrderDetail> => {
      const next = OrderService.nextStepOf(order.status);

      return {
        ...(await detailOf(order)),
        ...(order.userId === undefined ? {} : { userId: order.userId }),
        ...(next === undefined ? {} : { nextStatus: next }),
        canCancel: (OrderStatus.STAFF_CANCELABLE as readonly OrderStatus[]).includes(order.status),
        canRefund: (OrderStatus.REFUNDABLE as readonly OrderStatus[]).includes(order.status),
      };
    };

    const adminDetail = (orderId: OrderId): ResultAsync<AdminOrderDetail, DomainError> =>
      ResultAsync.fromSafePromise(repository.find(orderId)).andThen((order) =>
        order === undefined
          ? errAsync<AdminOrderDetail, DomainError>(notFound)
          : ResultAsync.fromSafePromise(adminDetailOf(order)),
      );

    /** Cancels an order from one of `from`, giving the stock back and telling the payment service. */
    const cancelFrom = async (
      orderId: OrderId,
      from: readonly OrderStatus[],
      reason: Readonly<{ note: string; email: string }>,
      actor?: StaffActor,
    ): Promise<boolean> => {
      const moved = await move({
        orderId,
        from,
        to: "canceled",
        note: reason.note,
        now: clock.now(),
        releaseStock: true,
        message: Messages.orderCanceled({ orderId }),
        ...(actor === undefined
          ? {}
          : {
              audit: {
                actor,
                action: "order.cancel",
                target: { type: "order", id: orderId },
                summary: "Canceled the order before it shipped",
              },
            }),
      });

      if (moved) await notify(orderId, (order, url) => OrderEmail.canceled(order, url, reason.email));
      return moved;
    };

    /** Saves the address an order went to, unless the account already has it. */
    const keepAddress = async (userId: UserId, contact: PlaceOrderInput["contact"], address: ShippingAddress): Promise<void> => {
      const known = await deps.accounts.addresses(userId);
      if (known.some((saved) => OrderService.sameAddress(saved.address, address))) return;

      await deps.accounts.keepAddress(userId, {
        label: address.line1.slice(0, 40),
        fullName: contact.fullName,
        phone: contact.phone,
        address,
        isDefault: false,
      });
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

      const option = await deps.shipping.findActive(body.shippingMethod);
      if (option === undefined) {
        return err({ _tag: "ValidationFailed", issues: [{ path: "shippingMethod", message: OrderService.METHOD_UNAVAILABLE }] });
      }

      // The server prices the order itself; the browser's total only proves
      // the customer saw the same number.
      const totals = Pricing.totals(view.lines, option);
      if (totals.totalCents < OrderService.MINIMUM_TOTAL_CENTS) return err({ _tag: "OrderTotalTooSmall" });
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
        ...(body.billingAddress === undefined ? {} : { billingAddress: body.billingAddress }),
        shipping: { code: option.code, name: option.name, estimate: Delivery.estimate(now, option) },
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

      if (input.userId !== undefined && body.shouldSaveAddress === true) {
        await keepAddress(input.userId, body.contact, body.address);
      }

      const charge = await deps.payments.startCharge({ orderId: placed.orderId, amountCents: totals.totalCents });
      if (charge.isErr()) return err(charge.error);

      return ok({
        orderId: placed.orderId,
        number: placed.number,
        ...(key === undefined ? {} : { key }),
        clientSecret: charge.value,
      });
    };

    /** Moves an order one step on and sends the email that step has. */
    const advance = async (
      actor: StaffActor,
      orderId: OrderId,
      change: OrderStatusChange,
    ): Promise<Result<AdminOrderDetail, DomainError>> => {
      const moved = await move({
        orderId,
        from: [OrderStatus.PREVIOUS[change.status]],
        to: change.status,
        now: clock.now(),
        ...(change.status === "shipped" ? { trackingNumber: change.trackingNumber, note: `Tracking number ${change.trackingNumber}` } : {}),
        audit: {
          actor,
          action: "order.status",
          target: { type: "order", id: orderId },
          summary: `Moved the order to ${OrderStatus.label[change.status].toLowerCase()}`,
          changes: { status: [OrderStatus.PREVIOUS[change.status], change.status] },
        },
      });

      if (!moved) {
        const exists = await repository.find(orderId);
        return err(exists === undefined ? notFound : { _tag: "OrderTransitionNotAllowed" });
      }

      if (change.status === "shipped") {
        await notify(orderId, (order, url) => OrderEmail.shipped(order, url, change.trackingNumber));
      }
      if (change.status === "delivered") {
        await notify(orderId, (order, url) => OrderEmail.delivered(order, url, deps.webOrigin));
      }

      return adminDetail(orderId);
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
        ResultAsync.fromSafePromise(
          Promise.all([
            deps.users.findUserById(userId),
            repository.latestOf(userId),
            deps.accounts.profileOf(userId),
            deps.accounts.defaultAddressOf(userId),
          ]),
        ).andThen(([user, latest, profile, saved]) => {
          if (user === undefined) return err<CheckoutPrefill, DomainError>({ _tag: "Unauthenticated" });

          // The profile wins over the last order, and the default address over the last order's.
          const fullName = profile?.fullName ?? latest?.contact.fullName;
          const phone = profile?.phone ?? latest?.contact.phone;
          const address = saved?.address ?? latest?.address;

          return ok<CheckoutPrefill, DomainError>({
            email: user.email,
            ...(fullName === undefined || phone === undefined
              ? {}
              : { contact: { fullName, email: latest?.contact.email ?? user.email, phone } }),
            ...(address === undefined ? {} : { address }),
            ...(latest === undefined ? {} : { shippingMethod: latest.shippingMethod }),
          });
        }),

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

      adminList: (query) => repository.adminList(query),

      adminDetail,

      advance: (actor, orderId, change) => new ResultAsync(advance(actor, orderId, change)),

      cancelByStaff: (actor, orderId) =>
        ResultAsync.fromSafePromise(
          cancelFrom(orderId, OrderStatus.STAFF_CANCELABLE, OrderService.CANCELED_BY_SHOP, actor),
        ).andThen((canceled) =>
          canceled
            ? adminDetail(orderId)
            : adminDetail(orderId).andThen(() => errAsync<AdminOrderDetail, DomainError>({ _tag: "OrderTransitionNotAllowed" })),
        ),

      refund: (actor, orderId) =>
        ResultAsync.fromSafePromise(
          move({
            orderId,
            from: OrderStatus.REFUNDABLE,
            to: "refunded",
            note: OrderService.REFUND_REQUESTED_NOTE,
            now: clock.now(),
            message: Messages.refundRequested({ orderId }),
            audit: {
              actor,
              action: "order.refund",
              target: { type: "order", id: orderId },
              summary: "Refunded the order in full",
            },
          }),
        ).andThen((refunded) =>
          refunded
            ? adminDetail(orderId)
            : adminDetail(orderId).andThen(() => errAsync<AdminOrderDetail, DomainError>({ _tag: "OrderTransitionNotAllowed" })),
        ),
    };
  },
} as const;
