import type { RatingDistribution } from "@prism/shared";
import { Stars } from "../../../shared/ui/index.ts";

/** The average, how many reviews make it, and how many gave each number of stars. */
export type RatingSummaryProps = Readonly<{ average: number; count: number; distribution: RatingDistribution }>;

/** The product's rating at a glance: the average in stars, and a bar per number of stars. */
export const RatingSummary = ({ average, count, distribution }: RatingSummaryProps) => {
  const stars = ["5", "4", "3", "2", "1"] as const;

  return (
    <div className="space-y-4">
      {/* The stars speak the average and the count, so the figures beside them are for the eye only. */}
      <div className="flex items-center gap-3">
        <span className="text-4xl font-semibold tabular-nums text-ink" aria-hidden="true">
          {count === 0 ? "-" : average.toFixed(1)}
        </span>
        <div className="flex flex-col items-start gap-1">
          <Stars rating={average} count={count} isTextShown={false} />
          <p className="text-sm text-ink-soft" aria-hidden="true">
            {count === 1 ? "1 review" : `${count} reviews`}
          </p>
        </div>
      </div>

      <ul className="space-y-1.5" aria-label="Reviews by stars">
        {stars.map((star) => {
          const share = count === 0 ? 0 : distribution[star] / count;

          return (
            <li className="flex items-center gap-3 text-sm" key={star}>
              <span className="w-14 shrink-0 text-ink-soft">{star === "1" ? "1 star" : `${star} stars`}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <span className="block h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
              </span>
              <span className="w-10 shrink-0 text-right tabular-nums text-ink-soft">{distribution[star]}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
