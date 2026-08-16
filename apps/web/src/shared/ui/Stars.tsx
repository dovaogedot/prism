import { match } from "ts-pattern";

/** Five stars, filled to the average. Decorative — the label carries the value. */
export const Stars = ({
  rating,
  count,
}: Readonly<{ rating: number; count: number }>) => (
  <span
    className="inline-flex items-center gap-1"
    title={`${rating.toFixed(1)} out of 5 from ${count} review${count === 1 ? "" : "s"}`}
  >
    <span aria-hidden="true" className="inline-flex">
      {[0, 1, 2, 3, 4].map((index) => (
        <svg key={index} viewBox="0 0 20 20" className="size-3.5">
          <defs>
            <linearGradient id={`star-${index}-${Math.round(rating * 10)}`}>
              <stop
                offset={`${Math.max(0, Math.min(1, rating - index)) * 100}%`}
                stopColor="var(--color-accent)"
              />
              <stop offset="0%" stopColor="var(--color-line-strong)" />
            </linearGradient>
          </defs>
          <path
            fill={`url(#star-${index}-${Math.round(rating * 10)})`}
            d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z"
          />
        </svg>
      ))}
    </span>
    <span className="text-xs text-ink-faint">
      {match(count)
        .with(0, () => "No reviews")
        .otherwise(() => `${rating.toFixed(1)} (${count})`)}
    </span>
  </span>
);
