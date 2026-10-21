/**
 * A product's reviews as the page holds them: the published pages, which
 * are the same for every reader, and the reader's own part (their review,
 * their votes and whether they may write one), which is fetched apart.
 */

import type { OwnReview, ReviewId, ReviewInput, ReviewPage, ReviewSort, ReviewViewer } from "@prism/shared";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Api } from "../../shared/api/client.ts";
import { useSession } from "../auth/session.ts";

/** What the reader is told about their own review, or about why they cannot write one. */
export type ReviewNotice = Readonly<{ tone: "accent" | "danger"; title: string; text: string }>;

export const ReviewNotice = {
  /** The notice above the review form; `undefined` when there is nothing to say. */
  of: (viewer: Pick<ReviewViewer, "canReview" | "reason" | "own">): ReviewNotice | undefined => {
    if (!viewer.canReview) {
      return {
        tone: "accent",
        title: "Reviews come from buyers",
        text: "You can review this product once an order of it has been delivered to you.",
      };
    }

    const own = viewer.own;
    if (own === undefined) return undefined;

    return ReviewNotice.ofOwn(own);
  },

  /** The notice for the reader's own review, by what the moderators made of it. */
  ofOwn: (own: Pick<OwnReview, "status" | "rejectionReason">): ReviewNotice => {
    switch (own.status) {
      case "pending":
        return {
          tone: "accent",
          title: "Your review is waiting for a moderator",
          text: "It appears on this page once a moderator approves it. You can still change it.",
        };
      case "approved":
        return { tone: "accent", title: "Your review is published", text: "Changing it sends it to a moderator again." };
      case "rejected":
        return {
          tone: "danger",
          title: "A moderator did not publish your review",
          text: `${own.rejectionReason ?? "No reason was given."} Change it and send it again.`,
        };
    }
  },
} as const;

export const ReviewKeys = {
  all: (slug: string) => ["reviews", slug] as const,
  page: (slug: string, sort: ReviewSort, page: number) => ["reviews", slug, "page", sort, page] as const,
  viewer: (slug: string, userId: string | undefined) => ["reviews", slug, "viewer", userId ?? "guest"] as const,
} as const;

/** One page of the product's published reviews, in the order chosen. */
export const useReviewPage = (slug: string, sort: ReviewSort, page: number) =>
  useQuery({
    queryKey: ReviewKeys.page(slug, sort, page),
    queryFn: ({ signal }) => Api.get<ReviewPage>(`/products/${slug}/reviews?sort=${sort}&page=${page}`, signal),
    placeholderData: keepPreviousData,
  });

/** What the signed-in reader may do with the product's reviews; nothing is fetched for a guest. */
export const useReviewViewer = (slug: string) => {
  const session = useSession();

  return useQuery({
    queryKey: ReviewKeys.viewer(slug, session?.id),
    queryFn: ({ signal }) => Api.get<ReviewViewer>(`/products/${slug}/reviews/viewer`, signal),
    enabled: session !== undefined,
  });
};

/** Writing, deleting and voting; each refreshes the product's reviews. */
export const useReviewChanges = (slug: string) => {
  const client = useQueryClient();

  const refresh = (): Promise<void> => client.invalidateQueries({ queryKey: ReviewKeys.all(slug) });

  const save = useMutation({
    mutationFn: (review: ReviewInput) => Api.put<OwnReview>(`/products/${slug}/reviews/mine`, review),
    onSuccess: refresh,
  });

  const remove = useMutation({
    mutationFn: () => Api.requestEmpty(`/products/${slug}/reviews/mine`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const vote = useMutation({
    mutationFn: (change: Readonly<{ reviewId: ReviewId; isHelpful: boolean }>) =>
      Api.requestEmpty(`/reviews/${change.reviewId}/vote`, { method: change.isHelpful ? "PUT" : "DELETE" }),
    onSettled: refresh,
  });

  return { save, remove, vote };
};
