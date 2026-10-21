/**
 * Reviews: reading a product's published reviews, writing one's own once an
 * order of the product was delivered, finding reviews helpful, and the
 * moderators' queue. A new or edited review waits for a moderator before
 * anyone but its author sees it.
 */

import type {
  AdminReviewQuery,
  AdminReviewView,
  DomainError,
  OwnReview,
  Page,
  ProductId,
  ReviewId,
  ReviewInput,
  ReviewPage,
  ReviewQueryParams,
  ReviewViewer,
  Slug,
  UserId,
} from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import type { Clock } from "../../platform/clock.ts";
import type { StaffActor } from "../staff/audit.ts";
import type { Decision, ModerationOutcome, ReviewRepository, VoteOutcome } from "./repository.ts";

/** What the reviews service works through. */
export type ReviewDependencies = Readonly<{
  repository: ReviewRepository;
  /** The first word of the reader's profile name, to start a byline with. */
  firstNameOf: (userId: UserId) => Promise<string | undefined>;
  clock: Clock;
}>;

/** Everything the reviews module does. */
export type ReviewService = Readonly<{
  published: (slug: Slug, query: ReviewQueryParams) => ResultAsync<ReviewPage, DomainError>;
  viewer: (slug: Slug, userId: UserId) => ResultAsync<ReviewViewer, DomainError>;
  /** Writes or edits the reader's review, which then waits for a moderator. */
  saveOwn: (slug: Slug, userId: UserId, review: ReviewInput) => ResultAsync<OwnReview, DomainError>;
  deleteOwn: (slug: Slug, userId: UserId) => ResultAsync<void, DomainError>;
  vote: (reviewId: ReviewId, userId: UserId) => ResultAsync<void, DomainError>;
  unvote: (reviewId: ReviewId, userId: UserId) => ResultAsync<void, DomainError>;
  queue: (query: AdminReviewQuery) => Promise<Page<AdminReviewView>>;
  moderate: (actor: StaffActor, reviewId: ReviewId, decision: Decision) => ResultAsync<void, DomainError>;
  remove: (actor: StaffActor, reviewId: ReviewId) => ResultAsync<void, DomainError>;
}>;

export const ReviewService = {
  PER_PAGE: 10,

  /** A refusal for a vote that changed nothing for a reason the reader should hear. */
  voteFailure: (outcome: VoteOutcome): DomainError | undefined => {
    if (outcome._tag === "NotFound") return { _tag: "ReviewNotFound" };
    if (outcome._tag === "OwnReview") return { _tag: "Forbidden" };
    return undefined;
  },

  moderationFailure: (outcome: ModerationOutcome): DomainError | undefined =>
    outcome._tag === "NotFound" ? { _tag: "ReviewNotFound" } : undefined,

  create: (deps: ReviewDependencies): ReviewService => {
    const { repository, clock } = deps;

    const productOf = (slug: Slug): ResultAsync<ProductId, DomainError> =>
      ResultAsync.fromSafePromise(repository.productIdOf(slug)).andThen((productId) =>
        productId === undefined
          ? errAsync<ProductId, DomainError>({ _tag: "ProductNotFound" })
          : okAsync<ProductId, DomainError>(productId),
      );

    /** Succeeds unless `failureOf` names a refusal for what `outcome` found. */
    const settle = <O>(outcome: Promise<O>, failureOf: (settled: O) => DomainError | undefined): ResultAsync<void, DomainError> =>
      ResultAsync.fromSafePromise(outcome).andThen((settled) => {
        const failure = failureOf(settled);
        return failure === undefined ? okAsync<void, DomainError>(undefined) : errAsync<void, DomainError>(failure);
      });

    return {
      published: (slug, query) =>
        productOf(slug).andThen((productId) =>
          ResultAsync.fromSafePromise(repository.published(productId, query.sort, query.page, ReviewService.PER_PAGE)),
        ),

      viewer: (slug, userId) =>
        productOf(slug).andThen((productId) =>
          ResultAsync.fromSafePromise(
            Promise.all([
              repository.isDeliveredTo(productId, userId),
              repository.own(productId, userId),
              repository.votesOf(productId, userId),
              deps.firstNameOf(userId),
            ]),
          ).map(([isDelivered, own, votedReviewIds, firstName]) => ({
            canReview: isDelivered,
            ...(isDelivered ? {} : { reason: "not_delivered" as const }),
            ...(own === undefined ? {} : { own }),
            votedReviewIds,
            ...(firstName === undefined ? {} : { suggestedAuthorName: firstName }),
          })),
        ),

      saveOwn: (slug, userId, review) =>
        productOf(slug).andThen((productId) =>
          ResultAsync.fromSafePromise(repository.isDeliveredTo(productId, userId)).andThen((isDelivered) => {
            if (!isDelivered) return errAsync<OwnReview, DomainError>({ _tag: "ReviewNotAllowed", reason: "not_delivered" });

            return ResultAsync.fromSafePromise(
              repository
                .saveOwn({ productId, userId, review, now: clock.now() })
                .then(() => repository.own(productId, userId)),
            ).andThen((saved) =>
              saved === undefined ? errAsync<OwnReview, DomainError>({ _tag: "ReviewNotFound" }) : okAsync<OwnReview, DomainError>(saved),
            );
          }),
        ),

      deleteOwn: (slug, userId) =>
        productOf(slug).andThen((productId) =>
          ResultAsync.fromSafePromise(repository.deleteOwn(productId, userId)).andThen((deleted) =>
            deleted ? okAsync<void, DomainError>(undefined) : errAsync<void, DomainError>({ _tag: "ReviewNotFound" }),
          ),
        ),

      vote: (reviewId, userId) => settle(repository.vote(reviewId, userId, clock.now()), ReviewService.voteFailure),

      unvote: (reviewId, userId) => settle(repository.unvote(reviewId, userId), ReviewService.voteFailure),

      queue: (query) => repository.queue(query),

      moderate: (actor, reviewId, decision) =>
        settle(repository.moderate({ reviewId, decision, actor, now: clock.now() }), ReviewService.moderationFailure),

      remove: (actor, reviewId) => settle(repository.remove({ reviewId, actor }), ReviewService.moderationFailure),
    };
  },
} as const;
