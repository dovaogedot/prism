/**
 * The payment service. It starts a charge when the order service asks,
 * records what the provider's webhooks say, and publishes every outcome to
 * the queue for the order service. It consumes cancellations, and cancels
 * the intent or refunds the charge.
 *
 * Every status change is conditional, so a webhook or a message delivered
 * twice changes the row once and publishes once.
 */

import type { ClientSecret, DomainError, OrderId, PaymentSummary } from "@prism/shared";
import { err, errAsync, ok, ResultAsync, type Result } from "neverthrow";
import { Messages, type OrderCanceled } from "../../messaging/messages.ts";
import type { Clock } from "../../platform/clock.ts";
import type { GatewayEvent, PaymentGateway } from "../../platform/payment-gateway.ts";
import type { PaymentRepository } from "./repository.ts";

/** The ports the payment service works through. */
export type PaymentDependencies = Readonly<{
  repository: PaymentRepository;
  /** Absent when payments are not configured. */
  gateway?: PaymentGateway;
  clock: Clock;
  /** Asks the outbox relay to publish soon. */
  kick: () => void;
  /** Reports an event that was received and deliberately not acted on. */
  onAnomaly: (message: string, detail: Readonly<Record<string, unknown>>) => void;
}>;

/** What the payment service offers the rest of the application. */
export type PaymentService = Readonly<{
  /** The order service's payment request: a pending charge row and an intent for the browser. */
  startCharge: (order: Readonly<{ orderId: OrderId; amountCents: number }>) => ResultAsync<ClientSecret, DomainError>;
  /** Verifies and records one webhook. */
  handleWebhook: (rawBody: Buffer, signature: string | undefined) => ResultAsync<void, DomainError>;
  /** Consumes `order.canceled`. Rejects when the provider cannot be reached, so the message is retried. */
  onOrderCanceled: (message: OrderCanceled) => Promise<void>;
  /** The charge and refund of an order, as its page shows them. */
  summaryOf: (orderId: OrderId) => Promise<PaymentSummary | undefined>;
}>;

export const PaymentService = {
  create: (deps: PaymentDependencies): PaymentService => {
    const { repository, gateway, clock } = deps;

    const transition = async (input: Parameters<PaymentRepository["transition"]>[0]): Promise<boolean> => {
      const moved = await repository.transition(input);
      if (moved && input.message !== undefined) deps.kick();
      return moved;
    };

    const record = async (event: GatewayEvent): Promise<void> => {
      if (event._tag === "Ignored") return;

      const payment = await repository.find(event.paymentId);

      if (payment === undefined) {
        deps.onAnomaly("webhook for an unknown payment", { paymentId: event.paymentId, event: event._tag });
        return;
      }

      switch (event._tag) {
        case "ChargeSucceeded": {
          if (event.amountCents !== payment.amountCents) {
            deps.onAnomaly("webhook amount does not match the charge", {
              paymentId: payment.id,
              expected: payment.amountCents,
              received: event.amountCents,
            });
            return;
          }

          // From failed or canceled too: a late success still has to reach the
          // order service, which refunds it if the order is gone.
          await transition({
            paymentId: payment.id,
            from: ["pending", "failed", "canceled"],
            to: "succeeded",
            reference: event.reference,
            details: event.card === undefined ? {} : { card: event.card },
            message: Messages.paymentStatus({ orderId: payment.orderId, paymentId: payment.id, outcome: "succeeded" }),
            now: clock.now(),
          });
          return;
        }

        case "ChargeFailed": {
          const moved = await transition({
            paymentId: payment.id,
            from: ["pending"],
            to: "failed",
            reference: event.reference,
            details: {
              failure: event.failure,
              ...(event.detail === undefined ? {} : { providerMessage: event.detail }),
              ...(event.card === undefined ? {} : { card: event.card }),
            },
            message: Messages.paymentStatus({
              orderId: payment.orderId,
              paymentId: payment.id,
              outcome: "failed",
              failure: event.failure,
            }),
            now: clock.now(),
          });

          // A declined intent stays confirmable; canceling it means this order
          // can never be charged later. A failure here changes nothing above.
          if (moved && gateway !== undefined) await gateway.cancelIntent(event.reference);
          return;
        }

        case "ChargeCanceled": {
          await transition({ paymentId: payment.id, from: ["pending"], to: "canceled", now: clock.now() });
          return;
        }

        case "RefundUpdated": {
          if (event.status === "pending") return;

          await transition({
            paymentId: payment.id,
            from: ["pending"],
            to: event.status === "succeeded" ? "succeeded" : "failed",
            reference: event.reference,
            ...(event.status === "succeeded"
              ? {
                  message: Messages.paymentStatus({
                    orderId: payment.orderId,
                    paymentId: payment.id,
                    outcome: "refunded",
                  }),
                }
              : {}),
            now: clock.now(),
          });
          return;
        }
      }
    };

    return {
      startCharge: ({ orderId, amountCents }) => {
        if (gateway === undefined) return errAsync({ _tag: "PaymentsUnavailable" });

        const run = async (): Promise<Result<ClientSecret, DomainError>> => {
          const paymentId = await repository.createCharge(orderId, amountCents, clock.now());
          const intent = await gateway.createIntent({ paymentId, orderId, amountCents });

          if (intent.isOk()) {
            await repository.attachReference(paymentId, intent.value.reference, clock.now());
            return ok(intent.value.clientSecret);
          }

          // The order service learns of this the same way as of a decline:
          // through the queue. It releases the stock and sends the email.
          await transition({
            paymentId,
            from: ["pending"],
            to: "failed",
            details: { failure: intent.error },
            message: Messages.paymentStatus({ orderId, paymentId, outcome: "failed", failure: intent.error }),
            now: clock.now(),
          });

          return err({ _tag: "PaymentGatewayUnavailable" });
        };

        return new ResultAsync(run());
      },

      handleWebhook: (rawBody, signature) => {
        if (gateway === undefined) return errAsync({ _tag: "PaymentsUnavailable" });

        return gateway
          .parseWebhook(rawBody, signature)
          .andThen((event) => ResultAsync.fromSafePromise(record(event)));
      },

      onOrderCanceled: async ({ orderId }) => {
        const charge = await repository.findOf(orderId, "charge");
        if (charge === undefined) return;

        if (charge.status === "pending") {
          if (charge.reference !== undefined && gateway !== undefined) {
            const canceled = await gateway.cancelIntent(charge.reference);
            if (canceled.isErr()) throw new Error(`Canceling the intent failed: ${canceled.error}`);
          }

          await transition({ paymentId: charge.id, from: ["pending"], to: "canceled", now: clock.now() });
          return;
        }

        if (charge.status !== "succeeded") return;

        const refund = await repository.ensureRefund(orderId, charge.amountCents, clock.now());
        if (refund.status !== "pending") return;

        if (gateway === undefined || charge.reference === undefined) {
          throw new Error("A succeeded charge cannot be refunded without the payment provider.");
        }

        // The refund row id is the idempotency key, so a retried message asks once.
        const created = await gateway.refund({ refundId: refund.id, intent: charge.reference, amountCents: refund.amountCents });
        if (created.isErr()) throw new Error(`The refund failed: ${created.error}`);

        if (created.value.status === "pending") {
          await repository.attachReference(refund.id, created.value.reference, clock.now());
          return;
        }

        await transition({
          paymentId: refund.id,
          from: ["pending"],
          to: created.value.status === "succeeded" ? "succeeded" : "failed",
          reference: created.value.reference,
          ...(created.value.status === "succeeded"
            ? { message: Messages.paymentStatus({ orderId, paymentId: refund.id, outcome: "refunded" }) }
            : {}),
          now: clock.now(),
        });
      },

      summaryOf: async (orderId) => {
        const charge = await repository.findOf(orderId, "charge");
        if (charge === undefined) return undefined;

        const refund = await repository.findOf(orderId, "refund");
        const refundState = refund === undefined ? undefined : PaymentService.refundStateOf(refund.status);

        return {
          status: charge.status,
          ...(charge.details.card === undefined ? {} : { card: charge.details.card }),
          ...(charge.details.failure === undefined ? {} : { failure: charge.details.failure }),
          ...(refundState === undefined ? {} : { refund: refundState }),
        };
      },
    };
  },

  /** A refund row as the customer reads it: a canceled refund did not happen either. */
  refundStateOf: (status: "pending" | "succeeded" | "failed" | "canceled"): "pending" | "succeeded" | "failed" =>
    status === "canceled" ? "failed" : status,
} as const;
