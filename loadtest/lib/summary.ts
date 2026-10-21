/** What every run measures against, and what it writes when it ends. */

/** The part of k6's end-of-run summary the runs read. */
type SummaryData = Readonly<{ metrics: Readonly<Record<string, Readonly<{ values: Readonly<Record<string, number>> }>>> }>;

export const Summary = {
  /** The percentiles every duration is reported at. */
  TREND_STATS: ["avg", "min", "med", "max", "p(90)", "p(95)", "p(99)"],

  /** The task's objectives: 90% of requests under 2 seconds, under 5% errors, and 98% of user steps successful. */
  THRESHOLDS: {
    http_req_duration: ["p(90)<2000"],
    http_req_failed: ["rate<0.05"],
    transaction_success: ["rate>=0.98"],
  },

  /** The whole summary as JSON for the report, under the run's name, and a few lines on screen. */
  of: (run: string, data: SummaryData): Readonly<Record<string, string>> => ({
    [`/loadtest/results/${run}.json`]: JSON.stringify(data, null, 2),
    stdout: Summary.text(run, data),
  }),

  text: (run: string, data: SummaryData): string => {
    const value = (metric: string, stat: string): number => data.metrics[metric]?.values[stat] ?? 0;
    const milliseconds = (stat: string): string => `${Math.round(value("http_req_duration", stat))} ms`;

    return [
      "",
      `${run}: ${value("vus_max", "max")} users at most`,
      `  requests      ${value("http_reqs", "count")} at ${value("http_reqs", "rate").toFixed(1)}/s, ${(value("http_req_failed", "rate") * 100).toFixed(2)}% failed`,
      `  user steps    ${value("transactions", "count")} at ${value("transactions", "rate").toFixed(1)}/s, ${(value("transaction_success", "rate") * 100).toFixed(2)}% successful`,
      `  durations     p50 ${milliseconds("med")}, p90 ${milliseconds("p(90)")}, p95 ${milliseconds("p(95)")}, p99 ${milliseconds("p(99)")}`,
      "",
    ].join("\n");
  },
} as const;
