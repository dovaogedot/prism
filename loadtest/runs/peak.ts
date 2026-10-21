/** A busy hour: 50 users in the mixed workload for five minutes, which must keep at least 10 user steps a second. */

import { Mix } from "../lib/mix.ts";
import { Shop } from "../lib/shop.ts";
import { Summary } from "../lib/summary.ts";

export const options = {
  insecureSkipTLSVerify: true,
  summaryTrendStats: Summary.TREND_STATS,
  thresholds: { ...Summary.THRESHOLDS, transactions: ["rate>=10"] },
  scenarios: { mixed: { executor: "constant-vus", vus: 50, duration: "5m", exec: "mixed" } },
};

export const setup = Shop.load;
export const mixed = Mix.run;
export const handleSummary = (data: Parameters<typeof Summary.of>[1]) => Summary.of("peak", data);
