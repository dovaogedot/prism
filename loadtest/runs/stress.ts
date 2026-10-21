/**
 * The breaking point: the mixed workload in steps from 25 to 400 users, a
 * minute at each, which stops once p95 passes 5 seconds or errors pass 5%.
 * The last step before it stopped is the most users the stack serves.
 */

import { Mix } from "../lib/mix.ts";
import { Shop } from "../lib/shop.ts";
import { Summary } from "../lib/summary.ts";

const Stress = {
  /** Half a minute to reach `target` users, then a minute held there. */
  stepTo: (target: number) => [
    { duration: "30s", target },
    { duration: "1m", target },
  ],
} as const;

export const options = {
  insecureSkipTLSVerify: true,
  summaryTrendStats: Summary.TREND_STATS,
  thresholds: {
    ...Summary.THRESHOLDS,
    http_req_duration: [{ threshold: "p(95)<5000", abortOnFail: true, delayAbortEval: "30s" }],
    http_req_failed: [{ threshold: "rate<0.05", abortOnFail: true, delayAbortEval: "30s" }],
  },
  scenarios: {
    mixed: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [25, 50, 100, 150, 200, 300, 400].flatMap(Stress.stepTo),
      exec: "mixed",
    },
  },
};

export const setup = Shop.load;
export const mixed = Mix.run;
export const handleSummary = (data: Parameters<typeof Summary.of>[1]) => Summary.of("stress", data);
