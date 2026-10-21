import { ReviewSort } from "@prism/shared";
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { match, P } from "ts-pattern";
import { Alert, EmptyState, Pagination, Skeleton } from "../../../shared/ui/index.ts";
import { NextPath } from "../../auth/next-path.ts";
import { useSession } from "../../auth/session.ts";
import { useReviewPage, useReviewViewer } from "../reviews.ts";
import { RatingSummary } from "./RatingSummary.tsx";
import { ReviewCard } from "./ReviewCard.tsx";
import { ReviewForm } from "./ReviewForm.tsx";

/** The product whose reviews the section shows. */
export type ReviewsSectionProps = Readonly<{ slug: string }>;

/**
 * The product page's reviews: the rating summary, the reader's own review
 * or the way to write one, and the published reviews in the order chosen,
 * a page at a time.
 */
export const ReviewsSection = ({ slug }: ReviewsSectionProps) => {
  const session = useSession();

  const { pathname } = useLocation();

  const [sort, setSort] = useState<ReviewSort>("helpful");

  const [page, setPage] = useState(1);

  const reviews = useReviewPage(slug, sort, page);

  const viewer = useReviewViewer(slug);

  const heading = useRef<HTMLHeadingElement>(null);

  const voted = new Set(viewer.data?.votedReviewIds ?? []);

  return (
    <section className="space-y-6 border-t border-line pt-10" aria-labelledby="reviews-heading">
      <h2 className="text-xl font-semibold text-ink" id="reviews-heading" ref={heading}>
        Reviews
      </h2>

      <div className="grid gap-10 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-6">
          {reviews.data === undefined ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <RatingSummary average={reviews.data.average} count={reviews.data.count} distribution={reviews.data.distribution} />
          )}

          {match({ session, viewer: viewer.data })
            .with({ session: undefined }, () => (
              <p className="text-sm text-ink-soft">
                Bought it?{" "}
                <Link className="font-medium text-accent underline underline-offset-2" to={`/login${NextPath.query(pathname)}`}>
                  Sign in
                </Link>{" "}
                to write a review.
              </p>
            ))
            .with({ viewer: P.nonNullable.select() }, (found) => <ReviewForm slug={slug} viewer={found} />)
            .otherwise(() => null)}
        </div>

        <div>
          {match(reviews)
            .with({ status: "error" }, () => <Alert title="The reviews did not load">Try again in a moment.</Alert>)
            .with({ data: P.nullish }, () => (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ))
            .when(
              ({ data }) => data.count === 0,
              () => <EmptyState title="No reviews yet">Customers can review it once their order has arrived.</EmptyState>,
            )
            .otherwise(({ data }) => (
              <>
                <label className="mb-2 flex items-center justify-end gap-2 text-sm text-ink-soft">
                  Sort reviews by
                  <select
                    className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink hover:border-line-strong"
                    value={sort}
                    onChange={(event) => {
                      setSort(ReviewSort.schema.catch("helpful").parse(event.target.value));
                      setPage(1);
                    }}
                  >
                    {ReviewSort.NAMES.map((option) => (
                      <option key={option} value={option}>
                        {ReviewSort.label[option]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className={reviews.isFetching ? "opacity-60" : ""}>
                  {data.items.map((review) => (
                    <ReviewCard
                      key={review.id}
                      slug={slug}
                      review={review}
                      isVoted={voted.has(review.id)}
                      isOwn={viewer.data?.own?.id === review.id}
                    />
                  ))}
                </div>

                <Pagination
                  page={data.page}
                  totalPages={data.totalPages}
                  label="Review pages"
                  onPage={(next) => {
                    setPage(next);
                    heading.current?.scrollIntoView({ block: "start" });
                  }}
                />
              </>
            ))}
        </div>
      </div>
    </section>
  );
};
