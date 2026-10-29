/** A normal day: 20 users in the mixed workload for five minutes. */

import { Mix } from "../lib/mix.ts"
import { Shop } from "../lib/shop.ts"
import { Summary } from "../lib/summary.ts"

export const options = {
  insecureSkipTLSVerify: true,
  summaryTrendStats: Summary.TREND_STATS,
  thresholds: Summary.THRESHOLDS,
  scenarios: { mixed: { executor: "constant-vus", vus: 20, duration: "5m", exec: "mixed" } },
}

export const setup = Shop.load
export const mixed = Mix.run
export const handleSummary = (data: Parameters<typeof Summary.write>[1]) => Summary.write("normal", data)
