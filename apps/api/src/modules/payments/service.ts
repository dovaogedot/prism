/**
 * The payment service. It starts a charge when the order service asks,
 * records what the provider's webhooks say, and publishes every outcome to
 * the queue for the order service. It consumes cancellations and refund
 * requests, and cancels the intent or refunds the charge, through the
 * provider the charge went through.
 *
 * Every status change is conditional, so a webhook or a message delivered
 * twice changes the row once and publishes once.
 */

import type { ClientSecret, DomainError, OrderId, PaymentSummary } from "@prism/shared";
import { err, errAsync, ok, ResultAsync, type Result } from "neverthrow";
import { Messages, type OrderCanceled, type OrderRefundRequested } from "../../messaging/messages.ts";
import type { Clock } from "../../platform/clock.ts";
import type { GatewayEvent, PaymentGateway, ProviderName } from "../../platform/payment-gateway.ts";
import type { PaymentRecord, PaymentRepository } from "./repository.ts";

/** The ports the payment service works through. */
export type PaymentDependencies = Readonly<{
  repository: PaymentRepository;
  /** The provider new charges go through; absent when payments are not configured. */
  gateway?: PaymentGateway;
  /** Every provider a stored payment may have gone through, by name, the one above included. */
  gateways: Readonly<Partial<Record<ProviderName, PaymentGateway>>>;
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
  /** Consumes `order.refund-requested`: refunds the charge in full. Rejects like `onOrderCanceled`. */
  onRefundRequested: (message: OrderRefundRequested) => Promise<void>;
  /** The charge and refund of an order, as its page shows them. */
  summaryOf: (orderId: OrderId) => Promise<PaymentSummary | undefined>;
}>;

export const PaymentService = {
  create: (deps: PaymentDependencies): PaymentService => {
    const { repository, gateway, clock } = deps;

    /** The provider a stored payment went through, when this instance can reach it. */
    const gatewayOf = (payment: PaymentRecord): PaymentGateway | undefined => deps.gateways[payment.provider];

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
          const provider = gatewayOf(payment);
          if (moved && provider !== undefined) await provider.cancelIntent(event.reference);
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

    /**
     * Gives a succeeded charge back in full, through the provider it went
     * through. Its refund row's id is the idempotency key, so a message
     * delivered twice asks once.
     */
    const refundInFull = async (charge: PaymentRecord): Promise<void> => {
      const refund = await repository.ensureRefund(charge.orderId, charge.amountCents, charge.provider, clock.now());
      if (refund.status !== "pending") return;

      const provider = gatewayOf(charge);
      if (provider === undefined || charge.reference === undefined) {
        throw new Error(`A ${charge.provider} charge cannot be refunded without that provider.`);
      }

      const created = await provider.refund({ refundId: refund.id, intent: charge.reference, amountCents: refund.amountCents });
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
          ? { message: Messages.paymentStatus({ orderId: charge.orderId, paymentId: refund.id, outcome: "refunded" }) }
          : {}),
        now: clock.now(),
      });
    };

    return {
      startCharge: ({ orderId, amountCents }) => {
        if (gateway === undefined) return errAsync({ _tag: "PaymentsUnavailable" });

        const run = async (): Promise<Result<ClientSecret, DomainError>> => {
          const paymentId = await repository.createCharge(orderId, amountCents, gateway.name, clock.now());
          const intent = await gateway.createIntent({ paymentId, orderId, amountCents });

          if (intent.isOk()) {
            await repository.attachReference(paymentId, intent.value.reference, clock.now());
            // A settled intent is recorded the way its webhook would have been.
            if (intent.value.settlement !== undefined) await record(intent.value.settlement);
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
        // Only Stripe sends webhooks.
        const stripe = deps.gateways.stripe;
        if (stripe === undefined) return errAsync({ _tag: "PaymentsUnavailable" });

        return stripe
          .parseWebhook(rawBody, signature)
          .andThen((event) => ResultAsync.fromSafePromise(record(event)));
      },

      onOrderCanceled: async ({ orderId }) => {
        const charge = await repository.findOf(orderId, "charge");
        if (charge === undefined) return;

        if (charge.status === "pending") {
          const provider = gatewayOf(charge);
          if (charge.reference !== undefined && provider !== undefined) {
            const canceled = await provider.cancelIntent(charge.reference);
            if (canceled.isErr()) throw new Error(`Canceling the intent failed: ${canceled.error}`);
          }

          await transition({ paymentId: charge.id, from: ["pending"], to: "canceled", now: clock.now() });
          return;
        }

        if (charge.status === "succeeded") await refundInFull(charge);
      },

      onRefundRequested: async ({ orderId }) => {
        const charge = await repository.findOf(orderId, "charge");
        if (charge === undefined || charge.status !== "succeeded") return;

        await refundInFull(charge);
      },

      summaryOf: async (orderId) => {
        const charge = await repository.findOf(orderId, "charge");
        if (charge === undefined) return undefined;

        const refund = await repository.findOf(orderId, "refund");
        const refundState = refund === undefined ? undefined : PaymentService.refundStateOf(refund.status);

        return {
          status: charge.status,
          ...(charge.reference === undefined ? {} : { reference: charge.reference }),
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
