/**
 * The RabbitMQ adapter against a real broker: the topology it declares,
 * a message making the trip, and the two ways a message reaches the
 * dead-letter queue. The memory queue the other suites use is held to the
 * delivery count measured here.
 */

import { RabbitMQContainer, type StartedRabbitMQContainer } from "@testcontainers/rabbitmq";
import { connect, type Channel, type ChannelModel } from "amqplib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrderCanceled, PaymentStatusChanged } from "../../src/messaging/messages.ts";
import { Topology } from "../../src/messaging/topology.ts";
import { MessageQueue } from "../../src/platform/queue.ts";

let container: StartedRabbitMQContainer;
let queue: MessageQueue;
let inspector: ChannelModel;

const received: PaymentStatusChanged[] = [];
const cancelAttempts = new Map<string, number>();

beforeAll(async () => {
  container = await new RabbitMQContainer("rabbitmq:4.3.6-management-alpine").start();
  queue = MessageQueue.rabbitmq({
    url: container.getAmqpUrl(),
    topology: Topology.declarations(),
    onFailure: () => undefined,
  });

  await queue.consume(Topology.PAYMENT_STATUS_QUEUE, PaymentStatusChanged.schema, async (message) => {
    received.push(message);
  });

  // Fails every time, like a refund whose provider stays down.
  await queue.consume(Topology.ORDER_CANCELED_QUEUE, OrderCanceled.schema, async (message) => {
    cancelAttempts.set(message.orderId, (cancelAttempts.get(message.orderId) ?? 0) + 1);
    throw new Error("the provider is down");
  });

  inspector = await connect(container.getAmqpUrl());
});

afterAll(async () => {
  await queue.close();
  await inspector.close();
  await container.stop();
});

/**
 * Runs `use` on a channel of its own. The broker closes a channel on any
 * failed operation, such as checking a queue that is not there yet, so no
 * probe can break the next one. A failure resolves to `undefined`.
 */
const inspect = async <T>(use: (channel: Channel) => Promise<T>): Promise<T | undefined> => {
  const channel = await inspector.createChannel();
  channel.on("error", () => undefined);

  try {
    return await use(channel);
  } catch {
    return undefined;
  } finally {
    await channel.close().catch(() => undefined);
  }
};

/** Polls the broker-side condition until it holds, for at most ten seconds. */
const eventually = async <T>(probe: () => Promise<T | undefined>): Promise<T> => {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error("The condition did not hold within ten seconds.");
};

/** The next message in the dead-letter queue, with why it died. */
const nextDeadLetter = () =>
  eventually(() =>
    inspect(async (channel) => {
      const message = await channel.get(Topology.DEAD_LETTER_QUEUE, { noAck: true });
      if (message === false) return undefined;

      return {
        body: JSON.parse(message.content.toString("utf8")) as unknown,
        reason: message.properties.headers?.["x-first-death-reason"] as unknown,
        queue: message.properties.headers?.["x-first-death-queue"] as unknown,
      };
    }),
  );

describe("the topology", () => {
  it("declares both working queues and the dead-letter queue once connected", async () => {
    for (const name of [Topology.PAYMENT_STATUS_QUEUE, Topology.ORDER_CANCELED_QUEUE, Topology.DEAD_LETTER_QUEUE]) {
      await expect(eventually(() => inspect((channel) => channel.checkQueue(name)))).resolves.toMatchObject({ queue: name });
    }
  });
});

describe("a message", () => {
  it("is published with a broker confirm and consumed", async () => {
    const message = {
      orderId: "6f1c2a52-3b8e-4f43-9a6e-1c2d3e4f5a6b",
      paymentId: "7a2d3b63-4c9f-4054-8b7f-2d3e4f5a6b7c",
      outcome: "succeeded",
    };

    await queue.publish({
      id: "9c4e5d85-6eb1-4276-ad91-4f5a6b7c8d9e",
      exchange: Topology.PAYMENTS_EXCHANGE,
      routingKey: Topology.PAYMENT_STATUS_KEY,
      body: message,
    });

    await eventually(async () => (received.length > 0 ? true : undefined));
    expect(received).toEqual([message]);
  });

  it("whose handler keeps failing is dead-lettered once the delivery limit is passed", async () => {
    const orderId = "8b3e4c74-5da0-4165-9c80-3e4f5a6b7c8d";

    await queue.publish({
      id: "ad5f6e96-7fc2-4387-be02-5a6b7c8d9e0f",
      exchange: Topology.ORDERS_EXCHANGE,
      routingKey: Topology.ORDER_CANCELED_KEY,
      body: { orderId },
    });

    const dead = await nextDeadLetter();

    expect(dead).toEqual({ body: { orderId }, reason: "delivery_limit", queue: Topology.ORDER_CANCELED_QUEUE });
    // The first delivery, then one per allowed return.
    expect(cancelAttempts.get(orderId)).toBe(Topology.DELIVERY_LIMIT + 1);
  });

  it("that fails its schema goes to the dead-letter queue at once, never reaching the handler", async () => {
    await queue.publish({
      id: "be6a7fa7-80d3-4498-8f13-6b7c8d9e0f1a",
      exchange: Topology.ORDERS_EXCHANGE,
      routingKey: Topology.ORDER_CANCELED_KEY,
      body: { orderId: "not-a-uuid" },
    });

    const dead = await nextDeadLetter();

    expect(dead).toEqual({ body: { orderId: "not-a-uuid" }, reason: "rejected", queue: Topology.ORDER_CANCELED_QUEUE });
    expect(cancelAttempts.has("not-a-uuid")).toBe(false);
  });
});

describe("the memory queue", () => {
  it("gives up after the same number of deliveries as the broker", async () => {
    const memory = MessageQueue.memory(Topology.declarations());
    let attempts = 0;

    await memory.consume(Topology.ORDER_CANCELED_QUEUE, OrderCanceled.schema, async () => {
      attempts += 1;
      throw new Error("the provider is down");
    });
    await memory.publish({
      id: "cf7b8ab8-91e4-45a9-9024-7c8d9e0f1a2b",
      exchange: Topology.ORDERS_EXCHANGE,
      routingKey: Topology.ORDER_CANCELED_KEY,
      body: { orderId: "8b3e4c74-5da0-4165-9c80-3e4f5a6b7c8d" },
    });
    await memory.drain();

    expect(attempts).toBe(Topology.DELIVERY_LIMIT + 1);
    expect(memory.deadLetters).toEqual([
      {
        queue: Topology.ORDER_CANCELED_QUEUE,
        body: { orderId: "8b3e4c74-5da0-4165-9c80-3e4f5a6b7c8d" },
        reason: "delivery_limit",
      },
    ]);
  });
});
