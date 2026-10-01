/**
 * The transactional outbox. A module writes its message into
 * `outbox_message` inside the transaction that makes the change the message
 * announces, so the message exists exactly when the change committed. The
 * relay publishes what is waiting. A crash between publishing and stamping
 * publishes a message twice, which every consumer tolerates.
 */

import { asc, inArray, isNull, sql } from "drizzle-orm";
import type { Database, Transaction } from "../db/client.ts";
import { outboxMessages } from "../db/schema.ts";
import type { MessageQueue } from "../platform/queue.ts";

/** A message as a module hands it to the outbox. */
export type OutboxEntry = Readonly<{ exchange: string; routingKey: string; body: unknown }>;

/** Publishes waiting messages. */
export type OutboxRelay = Readonly<{
  /** Publishes one batch. Resolves to how many messages went out. */
  flush: () => Promise<number>;
  /** Asks for a flush soon; does nothing until `start`. */
  kick: () => void;
  /** Flushes after every kick, and every `intervalMs` for anything left over. */
  start: (intervalMs: number) => void;
  /** Stops the timer and waits for a flush in progress. */
  stop: () => Promise<void>;
}>;

/** What the relay reads from, publishes to, and reports problems through. */
export type OutboxRelayDependencies = Readonly<{
  db: Database;
  queue: MessageQueue;
  onFailure: (reason: unknown) => void;
}>;

export const Outbox = {
  BATCH: 50,

  /** Writes a message that publishes once `tx` commits, and never if it rolls back. */
  enqueue: async (tx: Transaction, entry: OutboxEntry): Promise<void> => {
    await tx.insert(outboxMessages).values({ exchange: entry.exchange, routingKey: entry.routingKey, payload: entry.body });
  },
} as const;

export const OutboxRelay = {
  create: (deps: OutboxRelayDependencies): OutboxRelay => {
    const { db, queue } = deps;

    /**
     * Claims a batch with SKIP LOCKED, so two relays never publish the same
     * row at once. Publishing stops at the first failure; what went out is
     * stamped, and the rest waits for the next flush.
     */
    const flush = (): Promise<number> =>
      db.transaction(async (tx) => {
        const waiting = await tx
          .select()
          .from(outboxMessages)
          .where(isNull(outboxMessages.publishedAt))
          .orderBy(asc(outboxMessages.createdAt))
          .limit(Outbox.BATCH)
          .for("update", { skipLocked: true });

        const published: string[] = [];

        for (const message of waiting) {
          try {
            await queue.publish({
              id: message.id,
              exchange: message.exchange,
              routingKey: message.routingKey,
              body: message.payload,
            });
            published.push(message.id);
          } catch (reason) {
            deps.onFailure(reason);
            break;
          }
        }

        if (published.length > 0) {
          await tx
            .update(outboxMessages)
            .set({ publishedAt: sql`now()` })
            .where(inArray(outboxMessages.id, published));
        }

        return published.length;
      });

    // Not re-entrant: one flush runs at a time, and a kick during it asks for one more.
    const state: { running: Promise<void> | undefined; again: boolean; timer: NodeJS.Timeout | undefined } = {
      running: undefined,
      again: false,
      timer: undefined,
    };

    const run = (): void => {
      if (state.running !== undefined) {
        state.again = true;
        return;
      }

      state.running = flush()
        .then(() => undefined)
        .catch(deps.onFailure)
        .finally(() => {
          state.running = undefined;

          if (state.again) {
            state.again = false;
            run();
          }
        });
    };

    return {
      flush,

      kick: () => {
        if (state.timer !== undefined) run();
      },

      start: (intervalMs) => {
        state.timer = setInterval(run, intervalMs);
        run();
      },

      stop: async () => {
        clearInterval(state.timer);
        state.timer = undefined;
        state.again = false;
        await state.running;
      },
    };
  },
} as const;
