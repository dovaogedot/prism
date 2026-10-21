/**
 * The periodic chores: expire unpaid orders, delete guest carts nobody came
 * back for, and make the smaller copies of pictures that have none yet, a
 * few per pass. Every step is a conditional update, so two passes at once
 * change each row once.
 */

import type { ImageId } from "@prism/shared";
import type { CartRepository } from "../modules/cart/repository.ts";
import type { CatalogRepository } from "../modules/catalog/repository.ts";
import type { OrderService } from "../modules/orders/service.ts";
import type { Clock } from "../platform/clock.ts";
import type { ImageStore } from "../platform/image-store.ts";

/** What one pass did. */
export type HousekeepingReport = Readonly<{ expired: number; cartsDeleted: number; variantsMade: number }>;

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
  catalog: CatalogRepository;
  images: ImageStore;
  clock: Clock;
  onFailure: (reason: unknown) => void;
}>;

export const Housekeeping = {
  /** How many pictures one pass makes copies of, so a large backlog never holds a pass up for long. */
  VARIANTS_PER_PASS: 20,

  create: (deps: HousekeepingDependencies): Housekeeping => {
    // Pictures whose copies failed in this process, so one broken file does not take every pass's turn.
    const failed = new Set<ImageId>();

    const makeVariants = async (): Promise<number> => {
      let made = 0;

      for (const image of await deps.catalog.imagesWithoutVariants(Housekeeping.VARIANTS_PER_PASS, failed)) {
        try {
          await deps.catalog.recordImageSize(image.id, await deps.images.makeVariants(image));
          made += 1;
        } catch (reason) {
          failed.add(image.id);
          deps.onFailure(reason);
        }
      }

      return made;
    };

    const run = async (): Promise<HousekeepingReport> => ({
      expired: await deps.orders.expireOverdue(),
      cartsDeleted: await deps.carts.deleteExpired(deps.clock.now()),
      variantsMade: await makeVariants(),
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
