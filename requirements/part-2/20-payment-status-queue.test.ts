/**
 * REQUIREMENTS_2.md: "The payment system publishes status updates to a
 * message queue."
 *
 * The API runs against a real RabbitMQ here, the broker the shop runs, and a
 * queue of the test's own on the payments exchange sees what is published.
 */

import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq"
import { connect, type Channel, type ChannelModel } from "amqplib"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { App, type Application } from "../../apps/api/src/app.ts"
import { Topology } from "../../apps/api/src/messaging/topology.ts"
import { MessageQueue } from "../../apps/api/src/platform/queue.ts"
import { Shop } from "../../apps/api/tests/support/commerce.ts"
import { jsonOf, seedCatalog, startHarness, type Harness } from "../../apps/api/tests/support/harness.ts"

let harness: Harness
let broker: StartedRabbitMQContainer
let built: Application
/** The harness, with the app that publishes to the broker in place of the one with a memory queue. */
let shop: Harness
let inspector: ChannelModel
let channel: Channel
/** The test's own queue, bound to the payments exchange for every payment status. */
let tap: string

beforeAll(async () => {
  ;[harness, broker] = await Promise.all([startHarness(), new RabbitMQContainer("rabbitmq:4.3.6-management-alpine").start()])

  built = await App.build({
    config: harness.config,
    database: harness.database,
    overrides: {
      clock: harness.clock,
      mailer: harness.mailer,
      gateway: harness.gateway,
      addressVerifier: harness.addressVerifier,
      queue: MessageQueue.rabbitmq({ url: broker.getAmqpUrl(), topology: Topology.declarations(), onFailure: () => undefined }),
    },
  })
  shop = { ...harness, app: built.app, jobs: built.jobs }

  inspector = await connect(broker.getAmqpUrl())
  channel = await inspector.createChannel()
  await channel.assertExchange("payments", "topic", { durable: true })
  tap = (await channel.assertQueue("", { exclusive: true })).queue
  await channel.bindQueue(tap, "payments", "payment.status")
}, 180_000)

afterAll(async () => {
  await built.app.close()
  await inspector.close()
  await broker.stop()
  await harness.stop()
})

beforeEach(async () => {
  await harness.reset()
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 10 }])
})

/** Polls `probe` until it holds a value, for at most ten seconds: the broker delivers on its own time. */
const eventually = async <T>(probe: () => Promise<T | undefined>): Promise<T> => {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  throw new Error("Nothing arrived within ten seconds.")
}

/** The next message on the test's queue, with the exchange and routing key it came through. */
const nextPublished = () =>
  eventually(async () => {
    const message = await channel.get(tap, { noAck: true })
    if (message === false) return undefined

    return {
      exchange: message.fields.exchange,
      routingKey: message.fields.routingKey,
      body: JSON.parse(message.content.toString("utf8")) as unknown,
    }
  })

const statusOf = async (placed: { orderId: string; key?: string }): Promise<string> =>
  String(jsonOf(await Shop.call(shop, "GET", `/orders/${placed.orderId}?key=${placed.key}`))["status"])

describe("a payment status", () => {
  it("is published to RabbitMQ when the provider says a payment succeeded, and the order service acts on it", async () => {
    const placed = await Shop.placed(shop, await Shop.fill(shop, [["desk-lamp", 1]]))
    await Shop.succeed(shop, placed.charge)

    // Written to the outbox with the payment's change; the order has not heard yet.
    expect(await statusOf(placed)).toBe("pending_payment")
    expect(await built.jobs.relay.flush()).toBe(1)

    expect(await nextPublished()).toEqual({
      exchange: "payments",
      routingKey: "payment.status",
      body: { orderId: placed.orderId, paymentId: placed.charge.id, outcome: "succeeded" },
    })
    await eventually(async () => ((await statusOf(placed)) === "payment_successful" ? true : undefined))
  })

  it("is published when a payment failed, with the reason", async () => {
    const placed = await Shop.placed(shop, await Shop.fill(shop, [["desk-lamp", 1]]))
    await Shop.decline(shop, placed.charge, "card_declined", "insufficient_funds")
    await built.jobs.relay.flush()

    expect(await nextPublished()).toEqual({
      exchange: "payments",
      routingKey: "payment.status",
      body: { orderId: placed.orderId, paymentId: placed.charge.id, outcome: "failed", failure: "insufficient_funds" },
    })
    await eventually(async () => ((await statusOf(placed)) === "payment_failed" ? true : undefined))
  })
})
