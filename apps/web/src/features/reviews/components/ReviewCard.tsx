import type { ReviewView } from "@prism/shared";
import { Stars } from "../../../shared/ui/index.ts";
import { HelpfulButton } from "./HelpfulButton.tsx";

/** The review, the product it belongs to, and what the reader may do with it. */
export type ReviewCardProps = Readonly<{
  slug: string;
  review: ReviewView;
  /** Whether the reader marked it helpful. */
  isVoted: boolean;
  /** The reader's own review takes no vote from them. */
  isOwn: boolean;
}>;

/** One published review: its stars, title, byline, date, text and helpful votes. */
export const ReviewCard = ({ slug, review, isVoted, isOwn }: ReviewCardProps) => {
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });

  return (
    <article className="space-y-2 border-b border-line py-5 last:border-b-0">
      <Stars rating={review.rating} count={1} isCountShown={false} />
      {review.title === undefined ? null : <h3 className="font-semibold text-ink">{review.title}</h3>}
      <p className="text-sm text-ink-soft">
        {review.authorName} · <time dateTime={review.createdAt}>{date.format(new Date(review.createdAt))}</time>
        {review.editedAt === undefined ? null : <span> · edited</span>}
      </p>
      {review.body === undefined ? null : <p className="whitespace-pre-line leading-relaxed text-ink">{review.body}</p>}
      {isOwn ? (
        <p className="text-xs text-ink-faint">Your review · {review.helpfulCount} found it helpful</p>
      ) : (
        <HelpfulButton slug={slug} reviewId={review.id} count={review.helpfulCount} isVoted={isVoted} />
      )}
    </article>
  );
};
