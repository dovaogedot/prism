/**
 * The periodic chores: expire unpaid orders, move the simulated warehouse
 * one step, and delete guest carts nobody came back for. Every step is a
 * conditional update, so two passes at once change each row once.
 */

import type { Clock } from "../platform/clock.ts";
import type { CartRepository } from "../modules/cart/repository.ts";
import type { OrderService } from "../modules/orders/service.ts";

/** What one pass did. */
export type HousekeepingReport = Readonly<{ expired: number; advanced: number; cartsDeleted: number }>;

/** One pass on demand, or passes on a timer. */
export type Housekeeping = Readonly<{
  run: () => Promise<HousekeepingReport>;
  start: (intervalMs: number) => void;
  stop: () => Promise<void>;
}>;

/** What housekeeping works through. */
export type HousekeepingDependencies = Readonly<{
  orders: OrderService;
  carts: CartRepository;
  clock: Clock;
  onFailure: (reason: unknown) => void;
}>;

export const Housekeeping = {
  create: (deps: HousekeepingDependencies): Housekeeping => {
    const run = async (): Promise<HousekeepingReport> => ({
      expired: await deps.orders.expireOverdue(),
      advanced: await deps.orders.advanceFulfillment(),
      cartsDeleted: await deps.carts.deleteExpired(deps.clock.now()),
    });

    // Not re-entrant: a pass that outlasts the interval skips the next tick.
    const state: { running: Promise<void> | undefined; timer: NodeJS.Timeout | undefined } = {
      running: undefined,
      timer: undefined,
    };

    const tick = (): void => {
      if (state.running !== undefined) return;

      state.running = run()
        .then(() => undefined)
        .catch(deps.onFailure)
        .finally(() => {
          state.running = undefined;
        });
    };

    return {
      run,
      start: (intervalMs) => {
        state.timer = setInterval(tick, intervalMs);
      },
      stop: async () => {
        clearInterval(state.timer);
        state.timer = undefined;
        await state.running;
      },
    };
  },
} as const;
