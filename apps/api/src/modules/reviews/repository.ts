/**
 * Every database statement the reviews module makes. A product's rating
 * counts approved reviews only. A helpful vote and the count it adds to are
 * written in one transaction, so the count always equals the votes.
 */

import {
  Page,
  type AdminReviewQuery,
  type AdminReviewView,
  type OwnReview,
  type ProductId,
  type RatingDistribution,
  type ReviewId,
  type ReviewInput,
  type ReviewPage,
  type ReviewSort,
  type ReviewView,
  type Slug,
  type UserId,
} from "@prism/shared";
import { and, asc, count, desc, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/client.ts";
import { orderLines, orders, productReviews, products, reviewVotes } from "../../db/schema.ts";
import type { AuditLog, StaffActor } from "../staff/audit.ts";

/** What giving or taking back a helpful vote found. */
export type VoteOutcome =
  | Readonly<{ _tag: "Changed" }>
  | Readonly<{ _tag: "Unchanged" }>
  | Readonly<{ _tag: "NotFound" }>
  | Readonly<{ _tag: "OwnReview" }>;

/** What a moderator's decision found. */
export type ModerationOutcome = Readonly<{ _tag: "Done" }> | Readonly<{ _tag: "NotFound" }>;

/** A moderator's decision on one review. */
export type Decision = Readonly<{ _tag: "approve" }> | Readonly<{ _tag: "reject"; reason: string }>;

/** Every read and write the reviews module makes. */
export type ReviewRepository = Readonly<{
  /** How many reviews wait for a moderator. */
  countPending: () => Promise<number>;
  productIdOf: (slug: Slug) => Promise<ProductId | undefined>;
  /** One page of a product's approved reviews, with the rating of all of them. */
  published: (productId: ProductId, sort: ReviewSort, page: number, perPage: number) => Promise<ReviewPage>;
  /** Whether an order of the product reached the customer and stayed theirs. */
  isDeliveredTo: (productId: ProductId, userId: UserId) => Promise<boolean>;
  own: (productId: ProductId, userId: UserId) => Promise<OwnReview | undefined>;
  /** The reviews of the product the user found helpful. */
  votesOf: (productId: ProductId, userId: UserId) => Promise<readonly ReviewId[]>;
  /** Writes or replaces the user's review, which then waits for a moderator again. */
  saveOwn: (input: Readonly<{ productId: ProductId; userId: UserId; review: ReviewInput; now: Date }>) => Promise<void>;
  /** Resolves to whether there was a review to delete. */
  deleteOwn: (productId: ProductId, userId: UserId) => Promise<boolean>;
  /** Counts the user as finding an approved review helpful, once. */
  vote: (reviewId: ReviewId, userId: UserId, now: Date) => Promise<VoteOutcome>;
  /** Takes the user's vote back, if there was one. */
  unvote: (reviewId: ReviewId, userId: UserId) => Promise<VoteOutcome>;
  queue: (query: AdminReviewQuery) => Promise<Page<AdminReviewView>>;
  moderate: (input: Readonly<{ reviewId: ReviewId; decision: Decision; actor: StaffActor; now: Date }>) => Promise<ModerationOutcome>;
  remove: (input: Readonly<{ reviewId: ReviewId; actor: StaffActor }>) => Promise<ModerationOutcome>;
}>;

/** A review row as the reads return it. */
type ReviewRow = typeof productReviews.$inferSelect;

export const ReviewRepository = {
  /** Every sort ends in the id, so paging is stable when the keys tie. */
  ordering: {
    helpful: [desc(productReviews.helpfulCount), desc(productReviews.createdAt), asc(productReviews.id)],
    newest: [desc(productReviews.createdAt), asc(productReviews.id)],
    highest: [desc(productReviews.rating), desc(productReviews.createdAt), asc(productReviews.id)],
    lowest: [asc(productReviews.rating), desc(productReviews.createdAt), asc(productReviews.id)],
  } as const satisfies Record<ReviewSort, readonly SQL[]>,

  viewOf: (row: ReviewRow): ReviewView => ({
    id: row.id,
    rating: row.rating,
    authorName: row.authorName,
    ...(row.title === null ? {} : { title: row.title }),
    ...(row.body === null ? {} : { body: row.body }),
    helpfulCount: row.helpfulCount,
    createdAt: row.createdAt.toISOString(),
    ...(row.updatedAt.getTime() > row.createdAt.getTime() ? { editedAt: row.updatedAt.toISOString() } : {}),
  }),

  ownOf: (row: ReviewRow): OwnReview => ({
    ...ReviewRepository.viewOf(row),
    status: row.status,
    ...(row.rejectionReason === null ? {} : { rejectionReason: row.rejectionReason }),
  }),

  create: (db: Database, audit: AuditLog): ReviewRepository => ({
    countPending: async () => {
      const [row] = await db.select({ total: count() }).from(productReviews).where(eq(productReviews.status, "pending"));
      return row?.total ?? 0;
    },

    productIdOf: async (slug) => {
      const [row] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug));
      return row?.id;
    },

    published: async (productId, sort, page, perPage) => {
      const approved = and(eq(productReviews.productId, productId), eq(productReviews.status, "approved"));
      const [rows, stars] = await Promise.all([
        db
          .select()
          .from(productReviews)
          .where(approved)
          .orderBy(...ReviewRepository.ordering[sort])
          .limit(perPage)
          .offset((page - 1) * perPage),
        db
          .select({ rating: productReviews.rating, total: count() })
          .from(productReviews)
          .where(approved)
          .groupBy(productReviews.rating),
      ]);

      const distribution: Record<"1" | "2" | "3" | "4" | "5", number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
      let total = 0;
      let sum = 0;
      for (const row of stars) {
        const key = String(row.rating);
        if (key === "1" || key === "2" || key === "3" || key === "4" || key === "5") distribution[key] = row.total;
        total += row.total;
        sum += row.rating * row.total;
      }

      return {
        items: rows.map(ReviewRepository.viewOf),
        average: total === 0 ? 0 : Math.round((sum / total) * 10) / 10,
        count: total,
        distribution: distribution satisfies RatingDistribution,
        sort,
        page,
        perPage,
        totalPages: Page.count(total, perPage),
      };
    },

    isDeliveredTo: async (productId, userId) => {
      const [row] = await db
        .select({ id: orders.id })
        .from(orders)
        .innerJoin(orderLines, eq(orderLines.orderId, orders.id))
        .where(and(eq(orders.userId, userId), eq(orders.status, "delivered"), eq(orderLines.productId, productId)))
        .limit(1);

      return row !== undefined;
    },

    own: async (productId, userId) => {
      const [row] = await db
        .select()
        .from(productReviews)
        .where(and(eq(productReviews.productId, productId), eq(productReviews.userId, userId)));

      return row === undefined ? undefined : ReviewRepository.ownOf(row);
    },

    votesOf: async (productId, userId) =>
      (
        await db
          .select({ id: reviewVotes.reviewId })
          .from(reviewVotes)
          .innerJoin(productReviews, eq(productReviews.id, reviewVotes.reviewId))
          .where(and(eq(productReviews.productId, productId), eq(reviewVotes.userId, userId)))
      ).map((row) => row.id),

    saveOwn: async ({ productId, userId, review, now }) => {
      const written = {
        rating: review.rating,
        authorName: review.authorName,
        title: review.title ?? null,
        body: review.body ?? null,
        status: "pending" as const,
        rejectionReason: null,
        moderatedBy: null,
        moderatedAt: null,
        updatedAt: now,
      };

      await db
        .insert(productReviews)
        .values({ productId, userId, ...written, createdAt: now })
        .onConflictDoUpdate({ target: [productReviews.productId, productReviews.userId], set: written });
    },

    deleteOwn: async (productId, userId) => {
      const deleted = await db
        .delete(productReviews)
        .where(and(eq(productReviews.productId, productId), eq(productReviews.userId, userId)))
        .returning({ id: productReviews.id });

      return deleted.length > 0;
    },

    vote: (reviewId, userId, now) =>
      db.transaction(async (tx): Promise<VoteOutcome> => {
        const [review] = await tx
          .select({ userId: productReviews.userId, status: productReviews.status })
          .from(productReviews)
          .where(eq(productReviews.id, reviewId));
        if (review === undefined || review.status !== "approved") return { _tag: "NotFound" };
        if (review.userId === userId) return { _tag: "OwnReview" };

        const added = await tx
          .insert(reviewVotes)
          .values({ reviewId, userId, createdAt: now })
          .onConflictDoNothing()
          .returning({ id: reviewVotes.reviewId });
        if (added.length === 0) return { _tag: "Unchanged" };

        await tx
          .update(productReviews)
          .set({ helpfulCount: sql`${productReviews.helpfulCount} + 1` })
          .where(eq(productReviews.id, reviewId));

        return { _tag: "Changed" };
      }),

    unvote: (reviewId, userId) =>
      db.transaction(async (tx): Promise<VoteOutcome> => {
        const removed = await tx
          .delete(reviewVotes)
          .where(and(eq(reviewVotes.reviewId, reviewId), eq(reviewVotes.userId, userId)))
          .returning({ id: reviewVotes.reviewId });
        if (removed.length === 0) return { _tag: "Unchanged" };

        await tx
          .update(productReviews)
          .set({ helpfulCount: sql`${productReviews.helpfulCount} - 1` })
          .where(eq(productReviews.id, reviewId));

        return { _tag: "Changed" };
      }),

    queue: async (query) => {
      const matching = eq(productReviews.status, query.status);
      const [rows, totals] = await Promise.all([
        db
          .select({ review: productReviews, productSlug: products.slug, productName: products.name })
          .from(productReviews)
          .innerJoin(products, eq(products.id, productReviews.productId))
          .where(matching)
          // The queue is worked oldest first, so nobody waits longest.
          .orderBy(asc(productReviews.updatedAt), asc(productReviews.id))
          .limit(query.perPage)
          .offset((query.page - 1) * query.perPage),
        db.select({ total: count() }).from(productReviews).where(matching),
      ]);
      const total = totals[0]?.total ?? 0;

      return {
        items: rows.map((row) => ({
          ...ReviewRepository.ownOf(row.review),
          product: { slug: row.productSlug, name: row.productName },
          userId: row.review.userId,
          ...(row.review.moderatedAt === null ? {} : { moderatedAt: row.review.moderatedAt.toISOString() }),
        })),
        total,
        page: query.page,
        perPage: query.perPage,
        totalPages: Page.count(total, query.perPage),
      };
    },

    moderate: ({ reviewId, decision, actor, now }) =>
      db.transaction(async (tx): Promise<ModerationOutcome> => {
        const [changed] = await tx
          .update(productReviews)
          .set({
            status: decision._tag === "approve" ? "approved" : "rejected",
            rejectionReason: decision._tag === "approve" ? null : decision.reason,
            moderatedBy: actor.id,
            moderatedAt: now,
          })
          .where(eq(productReviews.id, reviewId))
          .returning({ productId: productReviews.productId });
        if (changed === undefined) return { _tag: "NotFound" };

        await audit.record(tx, {
          actor,
          action: decision._tag === "approve" ? "review.approve" : "review.reject",
          target: { type: "review", id: reviewId },
          summary: decision._tag === "approve" ? "Published a review" : "Rejected a review",
        });

        return { _tag: "Done" };
      }),

    remove: ({ reviewId, actor }) =>
      db.transaction(async (tx): Promise<ModerationOutcome> => {
        const [removed] = await tx
          .delete(productReviews)
          .where(eq(productReviews.id, reviewId))
          .returning({ id: productReviews.id });
        if (removed === undefined) return { _tag: "NotFound" };

        await audit.record(tx, { actor, action: "review.delete", target: { type: "review", id: reviewId }, summary: "Deleted a review" });

        return { _tag: "Done" };
      }),
  }),
} as const;
