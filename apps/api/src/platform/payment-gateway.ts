/**
 * The payment provider. Card data never reaches Prism: the browser hands it
 * to Stripe's own fields, and the API only ever sees an intent, its client
 * secret, and the events Stripe signs and sends back.
 *
 * The simulated provider stands in for Stripe on test and load-test stacks:
 * it settles every payment as it creates it, and the settlement takes the
 * same path through the outbox, the queue and the order service as Stripe's
 * webhook would. Stripe forbids load-testing its API.
 *
 * Every call that can fail answers with a `PaymentFailure` code, never a
 * rejection, so a timeout is a value the order flow handles like a decline.
 */

import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { ClientSecret, DeclineCodes, type DomainError, type OrderId, type PaymentFailure } from "@prism/shared"
import { errAsync, okAsync, ResultAsync } from "neverthrow"
import Stripe from "stripe"
import { z } from "zod"
import type { WebhookSecretSource } from "../config.ts"
import { PaymentId } from "../db/ids.ts"

/** The provider's id of an intent or a refund. Only a provider answer makes one. */
export type ProviderReference = z.infer<typeof ProviderReference.schema>
export const ProviderReference = {
  schema: z.string().min(1).brand<"ProviderReference">(),
} as const

/** Which card paid, in the only form the shop keeps. */
export type CardSummary = Readonly<{ brand: string; last4: string }>

/** Where a refund stands at the provider. */
export type RefundStatus = "pending" | "succeeded" | "failed" | "canceled"

/**
 * A signed event, reduced to what the payment service acts on. `paymentId`
 * is the payment row the intent or refund was created for, read from the
 * metadata Prism attached.
 */
export type GatewayEvent =
  | Readonly<{
      _tag: "ChargeSucceeded"
      paymentId: PaymentId
      reference: ProviderReference
      amountCents: number
      card?: CardSummary
    }>
  | Readonly<{
      _tag: "ChargeFailed"
      paymentId: PaymentId
      reference: ProviderReference
      failure: PaymentFailure
      /** The provider's own sentence, kept for support. */
      detail?: string
      card?: CardSummary
    }>
  | Readonly<{ _tag: "ChargeCanceled"; paymentId: PaymentId; reference: ProviderReference }>
  | Readonly<{ _tag: "RefundUpdated"; paymentId: PaymentId; reference: ProviderReference; status: RefundStatus }>
  /** Any other event, or one without Prism's metadata, such as from `stripe trigger`. */
  | Readonly<{ _tag: "Ignored"; type: string }>

/** An intent the browser can confirm. */
export type CreatedIntent = Readonly<{
  reference: ProviderReference
  clientSecret: ClientSecret
  /** Present when the provider settled the payment as it created it, as the simulated one does. */
  settlement?: GatewayEvent
}>

/** What canceling an intent found. */
export type CanceledIntent = Readonly<{
  /** Present when the intent was already paid: the success to record, since the cancel came too late. */
  settlement?: GatewayEvent
}>

/** Which provider a payment went through, as its row records it. */
export type ProviderName = "stripe" | "simulated"

/** A refund as the provider first answered it. */
export type CreatedRefund = Readonly<{ reference: ProviderReference; status: RefundStatus }>

/** Everything the shop asks of a payment provider. */
export type PaymentGateway = Readonly<{
  name: ProviderName
  /** The payment row id is the idempotency key, so a retried call creates one intent. */
  createIntent: (input: { paymentId: PaymentId; orderId: OrderId; amountCents: number }) => ResultAsync<CreatedIntent, PaymentFailure>
  /** Succeeds when the intent is canceled, and when it is already past canceling, saying when that is because it was paid. */
  cancelIntent: (reference: ProviderReference) => ResultAsync<CanceledIntent, PaymentFailure>
  /** Refunds a succeeded intent in full. `refundId` is the refund's own payment row. */
  refund: (input: { refundId: PaymentId; intent: ProviderReference; amountCents: number }) => ResultAsync<CreatedRefund, PaymentFailure>
  /** Checks the signature against the exact bytes received, then reads the event. */
  parseWebhook: (rawBody: Buffer, signature: string | undefined) => ResultAsync<GatewayEvent, DomainError>
}>

/** A gateway that answers from memory and records what it was asked. */
export type FakeGateway = PaymentGateway &
  Readonly<{
    calls: Readonly<{
      createIntent: readonly Readonly<{ paymentId: PaymentId; amountCents: number }>[]
      cancelIntent: readonly ProviderReference[]
      refund: readonly Readonly<{ refundId: PaymentId; intent: ProviderReference; amountCents: number }>[]
    }>
    /** Makes the next call of `operation` fail with `failure`. */
    failNext: (operation: "createIntent" | "refund", failure: PaymentFailure) => void
    /** Makes the next refund the provider creates answer `status` instead of `succeeded`. */
    answerNextRefund: (status: RefundStatus) => void
    /** Makes the next cancel find its intent already paid, as Stripe answers a cancel that came too late. */
    answerNextCancelAsPaid: () => void
    /** The intent id the fake created for a payment row. */
    intentOf: (paymentId: PaymentId) => ProviderReference | undefined
    /**
     * A Stripe event body and the signature header Stripe would send with it,
     * signed now or at `timestamp` (Unix seconds).
     */
    sign: (event: Readonly<{ type: string; object: Readonly<Record<string, unknown>>; timestamp?: number }>) => Readonly<{
      payload: string
      signature: string
    }>
    clear: () => void
  }>

/** The Stripe settings the gateway is built from. */
export type StripeGatewayOptions = Readonly<{
  secretKey: string
  webhookSecret: WebhookSecretSource
  timeoutMs: number
}>

export const PaymentGateway = {
  /** The metadata keys Prism puts on every intent and refund it creates. */
  PAYMENT_KEY: "prism_payment_id",
  ORDER_KEY: "prism_order_id",
  /** A fake card, for events signed by the fake gateway. */
  FAKE_CARD: { brand: "visa", last4: "4242" } satisfies CardSummary,
  FAKE_WEBHOOK_SECRET: "whsec_prism_test_secret",

  /**
   * What a provider error means for the customer. A request that never got
   * an answer is a timeout: the charge may or may not exist, and either way
   * nobody confirmed it.
   */
  failureOfError: (reason: unknown): PaymentFailure => {
    if (reason instanceof Stripe.errors.StripeConnectionError) return "gateway_timeout"

    if (reason instanceof Stripe.errors.StripeCardError) {
      return DeclineCodes.failureOf(reason.decline_code, reason.code)
    }

    return "gateway_error"
  },

  /** The payment row an intent or refund carries in its metadata, if it carries one. */
  paymentIdOf: (metadata: Readonly<Record<string, string>> | null | undefined): PaymentId | undefined => {
    const parsed = PaymentId.schema.safeParse(metadata?.[PaymentGateway.PAYMENT_KEY])
    return parsed.success ? parsed.data : undefined
  },

  cardOf: (method: Stripe.PaymentMethod): CardSummary | undefined =>
    method.card === undefined ? undefined : { brand: method.card.brand, last4: method.card.last4 },

  /** The card of a payment method that arrives either expanded or as a bare id. */
  cardOfMethod: async (
    method: string | Stripe.PaymentMethod | null,
    retrieveCard: (paymentMethodId: string) => Promise<CardSummary | undefined>,
  ): Promise<CardSummary | undefined> => {
    if (method === null) return undefined
    if (typeof method === "string") return retrieveCard(method)
    return PaymentGateway.cardOf(method)
  },

  /**
   * An event as the payment service acts on it. `retrieveCard` looks up the
   * card of a succeeded intent, whose payment method arrives as a bare id.
   */
  toGatewayEvent: async (
    event: Stripe.Event,
    retrieveCard: (paymentMethodId: string) => Promise<CardSummary | undefined>,
  ): Promise<GatewayEvent> => {
    const ignored: GatewayEvent = { _tag: "Ignored", type: event.type }

    switch (event.type) {
      case "payment_intent.succeeded":
        return PaymentGateway.succeededOf(event.data.object, retrieveCard)

      case "payment_intent.payment_failed": {
        const intent = event.data.object
        const paymentId = PaymentGateway.paymentIdOf(intent.metadata)
        if (paymentId === undefined) return ignored

        const error = intent.last_payment_error
        const method = error?.payment_method
        const card = method === undefined ? undefined : PaymentGateway.cardOf(method)

        return {
          _tag: "ChargeFailed",
          paymentId,
          reference: ProviderReference.schema.parse(intent.id),
          failure: DeclineCodes.failureOf(error?.decline_code, error?.code),
          ...(error?.message === undefined ? {} : { detail: error.message }),
          ...(card === undefined ? {} : { card }),
        }
      }

      case "payment_intent.canceled": {
        const intent = event.data.object
        const paymentId = PaymentGateway.paymentIdOf(intent.metadata)
        if (paymentId === undefined) return ignored

        return { _tag: "ChargeCanceled", paymentId, reference: ProviderReference.schema.parse(intent.id) }
      }

      case "refund.updated": {
        const refund = event.data.object
        const paymentId = PaymentGateway.paymentIdOf(refund.metadata)
        if (paymentId === undefined) return ignored

        return {
          _tag: "RefundUpdated",
          paymentId,
          reference: ProviderReference.schema.parse(refund.id),
          status: PaymentGateway.refundStatusOf(refund.status),
        }
      }

      default:
        return ignored
    }
  },

  /** A refund that needs action from the customer has not succeeded yet. */
  refundStatusOf: (status: string | null): RefundStatus => {
    if (status === "succeeded" || status === "failed" || status === "canceled") return status
    return "pending"
  },

  /** The signature check, shared by the real gateway and the fake. */
  verify: (rawBody: Buffer, signature: string | undefined, secret: string): ResultAsync<Stripe.Event, DomainError> => {
    if (signature === undefined || secret.length === 0) {
      return errAsync({ _tag: "WebhookSignatureInvalid" })
    }

    return ResultAsync.fromPromise(Stripe.webhooks.constructEventAsync(rawBody, signature, secret), (): DomainError => ({
      _tag: "WebhookSignatureInvalid",
    }))
  },

  /** A paid intent as the payment service records it; `Ignored` without Prism's metadata. */
  succeededOf: async (
    intent: Stripe.PaymentIntent,
    retrieveCard: (paymentMethodId: string) => Promise<CardSummary | undefined>,
  ): Promise<GatewayEvent> => {
    const paymentId = PaymentGateway.paymentIdOf(intent.metadata)
    if (paymentId === undefined) return { _tag: "Ignored", type: "payment_intent.succeeded" }

    const card = await PaymentGateway.cardOfMethod(intent.payment_method, retrieveCard)

    return {
      _tag: "ChargeSucceeded",
      paymentId,
      reference: ProviderReference.schema.parse(intent.id),
      amountCents: intent.amount_received,
      ...(card === undefined ? {} : { card }),
    }
  },

  /** Stripe test or live mode, depending on the key. */
  stripe: (options: StripeGatewayOptions): PaymentGateway => {
    const stripe = new Stripe(options.secretKey, {
      apiVersion: Stripe.API_VERSION,
      maxNetworkRetries: 1,
      timeout: options.timeoutMs,
    })

    // Read on every webhook: the local listener prints a new secret whenever
    // it starts, and the file is where it puts it.
    const secretOf = async (): Promise<string> =>
      options.webhookSecret.from === "value"
        ? options.webhookSecret.value
        : (await readFile(options.webhookSecret.path, "utf8").catch(() => "")).trim()

    const retrieveCard = async (paymentMethodId: string): Promise<CardSummary | undefined> =>
      stripe.paymentMethods
        .retrieve(paymentMethodId)
        .then(PaymentGateway.cardOf)
        .catch(() => undefined)

    return {
      name: "stripe",

      createIntent: ({ paymentId, orderId, amountCents }) =>
        ResultAsync.fromPromise(
          stripe.paymentIntents.create(
            {
              amount: amountCents,
              currency: "eur",
              allowed_payment_method_types: ["card"],
              metadata: { [PaymentGateway.PAYMENT_KEY]: paymentId, [PaymentGateway.ORDER_KEY]: orderId },
            },
            { idempotencyKey: `payment:${paymentId}` },
          ),
          PaymentGateway.failureOfError,
        ).andThen((intent) =>
          intent.client_secret === null
            ? errAsync<CreatedIntent, PaymentFailure>("gateway_error")
            : okAsync<CreatedIntent, PaymentFailure>({
                reference: ProviderReference.schema.parse(intent.id),
                clientSecret: ClientSecret.schema.parse(intent.client_secret),
              }),
        ),

      cancelIntent: (reference) =>
        ResultAsync.fromPromise(stripe.paymentIntents.cancel(reference), (reason) => reason)
          .map((): CanceledIntent => ({}))
          .orElse((reason) =>
            // Already canceled or already paid: there is nothing left to cancel, but a payment has to be recorded.
            reason instanceof Stripe.errors.StripeInvalidRequestError && reason.code === "payment_intent_unexpected_state"
              ? ResultAsync.fromPromise(stripe.paymentIntents.retrieve(reference), PaymentGateway.failureOfError).andThen((intent) =>
                  intent.status === "succeeded"
                    ? ResultAsync.fromSafePromise(PaymentGateway.succeededOf(intent, retrieveCard)).map((settlement): CanceledIntent => ({
                        settlement,
                      }))
                    : okAsync<CanceledIntent, PaymentFailure>({}),
                )
              : errAsync<CanceledIntent, PaymentFailure>(PaymentGateway.failureOfError(reason)),
          ),

      refund: ({ refundId, intent, amountCents }) =>
        ResultAsync.fromPromise(
          stripe.refunds.create(
            {
              payment_intent: intent,
              amount: amountCents,
              metadata: { [PaymentGateway.PAYMENT_KEY]: refundId },
            },
            { idempotencyKey: `refund:${refundId}` },
          ),
          PaymentGateway.failureOfError,
        ).map((refund) => ({
          reference: ProviderReference.schema.parse(refund.id),
          status: PaymentGateway.refundStatusOf(refund.status),
        })),

      parseWebhook: (rawBody, signature) =>
        ResultAsync.fromSafePromise(secretOf())
          .andThen((secret) => PaymentGateway.verify(rawBody, signature, secret))
          .andThen((event) => ResultAsync.fromSafePromise(PaymentGateway.toGatewayEvent(event, retrieveCard))),
    }
  },

  /**
   * The simulated provider: every intent is settled as it is created, every
   * refund succeeds at once, and no webhook ever arrives.
   */
  simulated: (): PaymentGateway => ({
    name: "simulated",

    createIntent: ({ paymentId, amountCents }) => {
      const reference = ProviderReference.schema.parse(`pi_simulated_${randomUUID().replaceAll("-", "")}`)

      return okAsync({
        reference,
        clientSecret: ClientSecret.schema.parse(`${reference}_secret_simulated`),
        settlement: { _tag: "ChargeSucceeded", paymentId, reference, amountCents, card: PaymentGateway.FAKE_CARD },
      })
    },

    cancelIntent: () => okAsync({}),

    refund: () =>
      okAsync({
        reference: ProviderReference.schema.parse(`re_simulated_${randomUUID().replaceAll("-", "")}`),
        status: "succeeded",
      }),

    // Nothing signs webhooks for a provider that does not exist.
    parseWebhook: () => errAsync({ _tag: "WebhookSignatureInvalid" }),
  }),

  /**
   * A gateway for tests. Intents are `pi_fake_<n>`, refunds succeed at once
   * unless `answerNextRefund` says otherwise, and webhooks are checked with the real signature code against a fixed
   * secret that `sign` uses too.
   */
  fake: (): FakeGateway => {
    const createIntent: { paymentId: PaymentId; amountCents: number }[] = []
    const cancelIntent: ProviderReference[] = []
    const refund: { refundId: PaymentId; intent: ProviderReference; amountCents: number }[] = []
    const intents = new Map<PaymentId, ProviderReference>()
    const failures = new Map<"createIntent" | "refund", PaymentFailure>()
    let nextRefundStatus: RefundStatus = "succeeded"
    let shouldPayNextCancel = false
    let sequence = 0

    const takeFailure = (operation: "createIntent" | "refund"): PaymentFailure | undefined => {
      const failure = failures.get(operation)
      failures.delete(operation)
      return failure
    }

    return {
      // The fake stands in for Stripe, so its payments are recorded as Stripe's.
      name: "stripe",
      calls: { createIntent, cancelIntent, refund },

      failNext: (operation, failure) => {
        failures.set(operation, failure)
      },

      answerNextRefund: (status) => {
        nextRefundStatus = status
      },

      answerNextCancelAsPaid: () => {
        shouldPayNextCancel = true
      },

      intentOf: (paymentId) => intents.get(paymentId),

      createIntent: ({ paymentId, amountCents }) => {
        createIntent.push({ paymentId, amountCents })

        const failure = takeFailure("createIntent")
        if (failure !== undefined) return errAsync(failure)

        sequence += 1
        const reference = ProviderReference.schema.parse(`pi_fake_${sequence}`)
        intents.set(paymentId, reference)

        return okAsync({ reference, clientSecret: ClientSecret.schema.parse(`${reference}_secret_fake`) })
      },

      cancelIntent: (reference) => {
        cancelIntent.push(reference)
        if (!shouldPayNextCancel) return okAsync({})

        shouldPayNextCancel = false
        const paymentId = [...intents].find(([, intent]) => intent === reference)?.[0]
        const created = createIntent.find((call) => call.paymentId === paymentId)
        if (paymentId === undefined || created === undefined) return okAsync({})

        return okAsync({
          settlement: { _tag: "ChargeSucceeded", paymentId, reference, amountCents: created.amountCents, card: PaymentGateway.FAKE_CARD },
        })
      },

      refund: (input) => {
        refund.push(input)

        const failure = takeFailure("refund")
        if (failure !== undefined) return errAsync(failure)

        sequence += 1
        const status = nextRefundStatus
        nextRefundStatus = "succeeded"

        return okAsync({ reference: ProviderReference.schema.parse(`re_fake_${sequence}`), status })
      },

      parseWebhook: (rawBody, signature) =>
        PaymentGateway.verify(rawBody, signature, PaymentGateway.FAKE_WEBHOOK_SECRET).andThen((event) =>
          ResultAsync.fromSafePromise(PaymentGateway.toGatewayEvent(event, async () => PaymentGateway.FAKE_CARD)),
        ),

      sign: ({ type, object, timestamp }) => {
        sequence += 1
        const signedAt = timestamp ?? Math.floor(Date.now() / 1000)

        const payload = JSON.stringify({
          id: `evt_fake_${sequence}`,
          object: "event",
          api_version: Stripe.API_VERSION,
          created: signedAt,
          type,
          data: { object },
        })

        return {
          payload,
          signature: Stripe.webhooks.generateTestHeaderString({
            payload,
            secret: PaymentGateway.FAKE_WEBHOOK_SECRET,
            timestamp: signedAt,
          }),
        }
      },

      clear: () => {
        createIntent.length = 0
        cancelIntent.length = 0
        refund.length = 0
        intents.clear()
        failures.clear()
        nextRefundStatus = "succeeded"
        shouldPayNextCancel = false
      },
    }
  },
} as const
