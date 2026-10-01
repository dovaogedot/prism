/**
 * The message queue between the order and payment services.
 *
 * Every working queue is a quorum queue with a delivery limit and a
 * dead-letter exchange. A handler that throws has its message rejected with
 * requeue, which the broker counts as a failed delivery; once it has counted
 * more than the limit, the message moves to the dead-letter queue. A message
 * that fails its schema can never succeed, so it is rejected without requeue
 * and goes there at once.
 */

import amqp, { type Channel } from "amqp-connection-manager";
import type { ConsumeMessage } from "amqplib";
import type { z } from "zod";

/** One durable queue and the binding that fills it. */
export type QueueDeclaration = Readonly<{
  name: string;
  exchange: string;
  routingKey: string;
  /** Left out for the dead-letter queue itself, which nothing consumes. */
  deadLetterExchange?: string;
  /** How many times a message may be returned before it is dead-lettered. */
  deliveryLimit?: number;
}>;

/** Every exchange and queue the application expects the broker to have. */
export type Topology = Readonly<{
  exchanges: readonly Readonly<{ name: string; type: "topic" | "fanout" }>[];
  queues: readonly QueueDeclaration[];
}>;

/** A message on its way to an exchange. The id lets a consumer spot a duplicate. */
export type OutgoingMessage = Readonly<{ id: string; exchange: string; routingKey: string; body: unknown }>;

/** A message the memory queue gave up on, and why. */
export type DeadLetter = Readonly<{
  queue: string;
  body: unknown;
  reason: "rejected" | "delivery_limit";
}>;

/** Publishing and consuming. */
export type MessageQueue = Readonly<{
  /** Resolves once the broker has confirmed the message, and rejects if it cannot. */
  publish: (message: OutgoingMessage) => Promise<void>;
  /**
   * Hands every message of `queue` that passes `schema` to `handler`. A
   * handler that rejects asks for the message again.
   */
  consume: <S extends z.ZodType>(
    queue: string,
    schema: S,
    handler: (body: z.output<S>) => Promise<void>,
  ) => Promise<void>;
  close: () => Promise<void>;
}>;

/** A queue held in memory, which delivers only when told to. */
export type MemoryQueue = MessageQueue &
  Readonly<{
    /** Delivers until every consumed queue is empty. Resolves to the number of deliveries. */
    drain: () => Promise<number>;
    deadLetters: readonly DeadLetter[];
    /** Messages waiting in a queue nothing consumes, the dead-letter queue aside. */
    waiting: (queue: string) => readonly unknown[];
    clear: () => void;
  }>;

/** What the RabbitMQ adapter connects to, declares, and reports problems through. */
export type RabbitOptions = Readonly<{
  url: string;
  topology: Topology;
  /** Called for connection failures and failed handlers. */
  onFailure: (context: string, reason: unknown) => void;
}>;

export const MessageQueue = {
  PREFETCH: 10,
  PUBLISH_TIMEOUT_MS: 10_000,

  /** The queue arguments a declaration turns into. */
  argumentsOf: (queue: QueueDeclaration): Readonly<Record<string, unknown>> => ({
    "x-queue-type": "quorum",
    ...(queue.deadLetterExchange === undefined ? {} : { "x-dead-letter-exchange": queue.deadLetterExchange }),
    ...(queue.deliveryLimit === undefined ? {} : { "x-delivery-limit": queue.deliveryLimit }),
  }),

  /** Whether a binding with `pattern` takes a message sent with `routingKey`. */
  matches: (type: "topic" | "fanout", pattern: string, routingKey: string): boolean =>
    type === "fanout" || pattern === "#" || pattern === routingKey,

  /**
   * A broker connection that reconnects by itself and declares the topology
   * again on every connect. Publishes go over a confirm channel.
   */
  rabbitmq: (options: RabbitOptions): MessageQueue => {
    const connection = amqp.connect([options.url], { heartbeatIntervalInSeconds: 15 });

    connection.on("connectFailed", ({ err }) => options.onFailure("cannot reach the message broker", err));
    connection.on("disconnect", ({ err }) => options.onFailure("lost the message broker", err));

    // The wrapper has no `reject`, which is what counts toward the delivery
    // limit, so messages are settled on the channel the setup was given.
    const live: { channel: Channel | undefined } = { channel: undefined };

    const channel = connection.createChannel({
      confirm: true,
      publishTimeout: MessageQueue.PUBLISH_TIMEOUT_MS,
      setup: async (setupChannel: Channel) => {
        live.channel = setupChannel;

        for (const exchange of options.topology.exchanges) {
          await setupChannel.assertExchange(exchange.name, exchange.type, { durable: true });
        }

        for (const queue of options.topology.queues) {
          await setupChannel.assertQueue(queue.name, { durable: true, arguments: MessageQueue.argumentsOf(queue) });
          await setupChannel.bindQueue(queue.name, queue.exchange, queue.routingKey);
        }

        await setupChannel.prefetch(MessageQueue.PREFETCH);
      },
    });

    return {
      publish: async (message) => {
        await channel.publish(message.exchange, message.routingKey, Buffer.from(JSON.stringify(message.body)), {
          persistent: true,
          messageId: message.id,
          contentType: "application/json",
        });
      },

      consume: async (queue, schema, handler) => {
        const onMessage = async (message: ConsumeMessage): Promise<void> => {
          // Read before any await: a message can only be settled on the channel that delivered it.
          const deliveredOn = live.channel;

          /** Settles the message. On a channel that has closed since, the broker redelivers it anyway. */
          const settle = (action: (target: Channel) => void): void => {
            if (deliveredOn === undefined) return;

            try {
              action(deliveredOn);
            } catch (reason) {
              options.onFailure(`could not settle a message on ${queue}`, reason);
            }
          };

          const parsed = (() => {
            try {
              return schema.safeParse(JSON.parse(message.content.toString("utf8")));
            } catch {
              return undefined;
            }
          })();

          if (parsed === undefined || !parsed.success) {
            options.onFailure(`rejected a malformed message on ${queue}`, parsed?.error);
            settle((target) => target.reject(message, false));
            return;
          }

          try {
            await handler(parsed.data);
            settle((target) => target.ack(message));
          } catch (reason) {
            options.onFailure(`a handler on ${queue} failed`, reason);
            settle((target) => target.reject(message, true));
          }
        };

        await channel.consume(queue, (message) => void onMessage(message), { noAck: false });
      },

      close: async () => {
        await channel.close();
        await connection.close();
      },
    };
  },

  /**
   * The same contract in memory, for tests: nothing is delivered until
   * `drain`, a handler that keeps failing is dead-lettered after the
   * delivery limit, and a malformed message is dead-lettered at once.
   */
  memory: (topology: Topology): MemoryQueue => {
    type Envelope = { body: unknown; returns: number };
    type Consumer = Readonly<{ schema: z.ZodType; handler: (body: never) => Promise<void> }>;

    const queues = new Map<string, Envelope[]>(topology.queues.map((queue) => [queue.name, []]));
    const consumers = new Map<string, Consumer>();
    const deadLetters: DeadLetter[] = [];

    const declarationOf = (name: string): QueueDeclaration => {
      const declaration = topology.queues.find((queue) => queue.name === name);
      if (declaration === undefined) throw new Error(`No queue named ${name}.`);
      return declaration;
    };

    const deliverOne = async (name: string, envelope: Envelope, consumer: Consumer): Promise<void> => {
      const parsed = consumer.schema.safeParse(envelope.body);

      if (!parsed.success) {
        deadLetters.push({ queue: name, body: envelope.body, reason: "rejected" });
        return;
      }

      try {
        await (consumer.handler as (body: unknown) => Promise<void>)(parsed.data);
      } catch {
        const returns = envelope.returns + 1;

        if (returns > (declarationOf(name).deliveryLimit ?? Number.POSITIVE_INFINITY)) {
          deadLetters.push({ queue: name, body: envelope.body, reason: "delivery_limit" });
        } else {
          queues.get(name)?.push({ body: envelope.body, returns });
        }
      }
    };

    return {
      deadLetters,

      publish: async (message) => {
        const exchange = topology.exchanges.find((candidate) => candidate.name === message.exchange);
        if (exchange === undefined) throw new Error(`No exchange named ${message.exchange}.`);

        // A round trip through JSON, so a test sees exactly what the broker would carry.
        const body: unknown = JSON.parse(JSON.stringify(message.body));

        for (const queue of topology.queues) {
          if (queue.exchange === exchange.name && MessageQueue.matches(exchange.type, queue.routingKey, message.routingKey)) {
            queues.get(queue.name)?.push({ body, returns: 0 });
          }
        }
      },

      consume: async (queue, schema, handler) => {
        declarationOf(queue);
        consumers.set(queue, { schema, handler });
      },

      drain: async () => {
        let deliveries = 0;
        let delivered = true;

        while (delivered) {
          delivered = false;

          for (const [name, consumer] of consumers) {
            const envelope = queues.get(name)?.shift();
            if (envelope === undefined) continue;

            delivered = true;
            deliveries += 1;
            await deliverOne(name, envelope, consumer);
          }
        }

        return deliveries;
      },

      waiting: (queue) => (queues.get(queue) ?? []).map((envelope) => envelope.body),

      clear: () => {
        for (const messages of queues.values()) messages.length = 0;
        deadLetters.length = 0;
      },

      close: async () => undefined,
    };
  },
} as const;
