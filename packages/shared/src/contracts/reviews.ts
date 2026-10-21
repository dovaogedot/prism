/**
 * Product reviews as the API serves them and the browser sends them. A
 * review waits for a moderator before anyone but its author sees it.
 */

import { z } from "zod";

/** The identity of a review, as the database assigns it. */
export type ReviewId = z.infer<typeof ReviewId.schema>;
export const ReviewId = {
  schema: z.uuid().brand<"ReviewId">(),
} as const;

/** Where a review stands with the moderators. */
export type ReviewStatus = (typeof ReviewStatus.NAMES)[number];
export const ReviewStatus = {
  NAMES: ["pending", "approved", "rejected"] as const,
  schema: z.enum(["pending", "approved", "rejected"]),
  label: {
    pending: "Waiting for approval",
    approved: "Published",
    rejected: "Rejected",
  } as const satisfies Record<"pending" | "approved" | "rejected", string>,
} as const;

/** The orders reviews can be listed in. */
export type ReviewSort = (typeof ReviewSort.NAMES)[number];
export const ReviewSort = {
  NAMES: ["helpful", "newest", "highest", "lowest"] as const,
  schema: z.enum(["helpful", "newest", "highest", "lowest"]),
  label: {
    helpful: "Most helpful",
    newest: "Newest",
    highest: "Highest rating",
    lowest: "Lowest rating",
  } as const satisfies Record<"helpful" | "newest" | "highest" | "lowest", string>,
} as const;

/** A text field a person may leave empty, which then counts as absent. */
export const OptionalText = {
  of: (max: number, tooLong: string) =>
    z
      .string()
      .trim()
      .max(max, tooLong)
      .transform((text) => (text.length === 0 ? undefined : text))
      .optional(),
} as const;

/** A validated `PUT /products/:slug/reviews/mine` body. */
export type ReviewInput = z.infer<typeof ReviewInput.schema>;
export const ReviewInput = {
  schema: z.strictObject({
    rating: z
      .number({ error: "Choose a rating." })
      .int("Choose a whole number of stars.")
      .min(1, "Choose 1 to 5 stars.")
      .max(5, "Choose 1 to 5 stars."),
    /** The name the review is signed with, which keeps the account's own name and email private. */
    authorName: z
      .string({ error: "Enter the name to sign with." })
      .trim()
      .min(2, "Use at least 2 characters.")
      .max(40, "Use at most 40 characters."),
    title: OptionalText.of(120, "Use at most 120 characters."),
    body: OptionalText.of(2000, "Use at most 2,000 characters."),
  }),
} as const;

/** A validated `POST /admin/reviews/:id/reject` body. The author reads the reason. */
export type RejectReviewInput = z.infer<typeof RejectReviewInput.schema>;
export const RejectReviewInput = {
  schema: z.strictObject({
    reason: z
      .string({ error: "Say why, for the author." })
      .trim()
      .min(3, "Say why, for the author.")
      .max(300, "Use at most 300 characters."),
  }),
} as const;

/** The query string of `GET /products/:slug/reviews`. */
export type ReviewQueryParams = z.infer<typeof ReviewQueryParams.schema>;
export const ReviewQueryParams = {
  schema: z.object({
    sort: ReviewSort.schema.default("helpful"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  }),
} as const;

/** A published review. */
export type ReviewView = Readonly<{
  id: ReviewId;
  rating: number;
  authorName: string;
  title?: string;
  body?: string;
  helpfulCount: number;
  createdAt: string;
  /** Present when the author changed it after writing it. */
  editedAt?: string;
}>;

/** How many approved reviews gave each number of stars. */
export type RatingDistribution = Readonly<Record<"1" | "2" | "3" | "4" | "5", number>>;

/** One page of a product's published reviews, with the rating they add up to. */
export type ReviewPage = Readonly<{
  items: readonly ReviewView[];
  /** The average of every approved review, to one decimal; 0 while there are none. */
  average: number;
  count: number;
  distribution: RatingDistribution;
  sort: ReviewSort;
  page: number;
  perPage: number;
  totalPages: number;
}>;

/** The reader's own review, in whatever state the moderators left it. */
export type OwnReview = ReviewView &
  Readonly<{
    status: ReviewStatus;
    /** Present when a moderator rejected it. */
    rejectionReason?: string;
  }>;

/** What the reader may do with a product's reviews. */
export type ReviewViewer = Readonly<{
  /** Whether the reader may write or edit a review of this product. */
  canReview: boolean;
  /** Present when `canReview` is false: the reader has no delivered order of the product. */
  reason?: "not_delivered";
  own?: OwnReview;
  /** The reviews of this product the reader found helpful. */
  votedReviewIds: readonly ReviewId[];
  /** The first word of the reader's profile name, to start the byline with; absent without a profile name. */
  suggestedAuthorName?: string;
}>;
