import { useId } from "react";
import { match } from "ts-pattern";

/** The average, how many ratings it comes from, and whether that count is shown. */
export type StarsProps = Readonly<{
  rating: number;
  count: number;
  /** False for one review's own rating, where a count says nothing. */
  isCountShown?: boolean;
  /** False where the average and the count are written beside the stars already. */
  isTextShown?: boolean;
}>;

/**
 * Five stars, filled to the rating. The stars are drawn for the eye; a
 * screen reader hears the rating in words instead.
 */
export const Stars = ({ rating, count, isCountShown = true, isTextShown = true }: StarsProps) => {
  // Each star's gradient needs an id no other element on the page has.
  const gradientId = useId();

  const spoken = match({ isCountShown, count })
    .with({ isCountShown: false }, () => `Rated ${rating} out of 5`)
    .with({ count: 0 }, () => "No reviews yet")
    .otherwise(() => `Rated ${rating.toFixed(1)} out of 5 from ${count} ${count === 1 ? "review" : "reviews"}`);

  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-flex" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <svg className="size-3.5" key={index} viewBox="0 0 20 20">
            <defs>
              <linearGradient id={`${gradientId}-${index}`}>
                <stop offset={`${Math.max(0, Math.min(1, rating - index)) * 100}%`} stopColor="var(--color-accent)" />
                <stop offset="0%" stopColor="var(--color-line-strong)" />
              </linearGradient>
            </defs>
            <path fill={`url(#${gradientId}-${index})`} d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z" />
          </svg>
        ))}
      </span>
      <span className="sr-only">{spoken}</span>
      {isCountShown && isTextShown ? (
        <span className="text-xs text-ink-faint" aria-hidden="true">
          {count === 0 ? "No reviews" : `${rating.toFixed(1)} (${count})`}
        </span>
      ) : null}
    </span>
  );
};
