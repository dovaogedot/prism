import type { ReviewId } from "@prism/shared";
import { Link, useLocation } from "react-router";
import { useSession } from "../../auth/session.ts";
import { NextPath } from "../../auth/next-path.ts";
import { useReviewChanges } from "../reviews.ts";

/** The review, how many found it helpful, whether the reader did, and the product it belongs to. */
export type HelpfulButtonProps = Readonly<{ slug: string; reviewId: ReviewId; count: number; isVoted: boolean }>;

/**
 * Marks a review helpful, or takes the mark back. A guest gets the way to
 * sign in instead, which comes back to this page.
 */
export const HelpfulButton = ({ slug, reviewId, count, isVoted }: HelpfulButtonProps) => {
  const session = useSession();

  const { pathname } = useLocation();

  const { vote } = useReviewChanges(slug);

  const label = `Helpful (${count})`;
  const buttonClass = "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors";

  if (session === undefined) {
    return (
      <Link className={`${buttonClass} border-line text-ink-soft hover:border-line-strong hover:text-ink`} to={`/login${NextPath.query(pathname)}`}>
        {label}
        <span className="sr-only">: sign in to vote</span>
      </Link>
    );
  }

  return (
    <button
      className={`${buttonClass} ${isVoted ? "border-accent bg-accent-wash text-ink" : "border-line text-ink-soft hover:border-line-strong hover:text-ink"}`}
      type="button"
      aria-pressed={isVoted}
      disabled={vote.isPending}
      onClick={() => vote.mutate({ reviewId, isHelpful: !isVoted })}
    >
      <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 11v9H4v-9zM7 11l4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7a2 2 0 0 1-2 1.7H7" />
      </svg>
      {label}
    </button>
  );
};
