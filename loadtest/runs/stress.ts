/**
 * The breaking point: the mixed workload in steps from 25 to 1,000 users, a
 * minute at each. It stops once p95 over the whole run passes 5 seconds or
 * errors pass 5%. The report reads the samples step by step, the ramp and
 * the held minute apart, for the most users a held minute served with p95
 * under 5 seconds.
 */

import { Mix } from "../lib/mix.ts";
import { Shop } from "../lib/shop.ts";
import { StressSteps } from "../lib/steps.ts";
import { Summary } from "../lib/summary.ts";

const Stress = {
  /** The ramp to `target` users, then the time held there. */
  stepTo: (target: number) => [
    { duration: `${StressSteps.RAMP_SECONDS}s`, target },
    { duration: `${StressSteps.HOLD_SECONDS}s`, target },
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
      stages: StressSteps.TARGETS.flatMap(Stress.stepTo),
      exec: "mixed",
    },
  },
};

export const setup = Shop.load;
export const mixed = Mix.run;
export const handleSummary = (data: Parameters<typeof Summary.of>[1]) => Summary.of("stress", data);
