/**
 * REQUIREMENTS_3.md: "Load test report shows transaction throughput."
 *
 * The README's figures are checked against k6's summaries of each run, which
 * the repository keeps in `loadtest/results`.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8")

/** Where k6's end-of-run summary of `run` is kept. */
const summaryOf = (run: string): URL => new URL(`../../loadtest/results/${run}.json`, import.meta.url)

/** Every load run the README reports. */
const runs = ["baseline", "normal", "peak", "stress"]

/** One run's row of the README's results table. */
type Reported = { requests: number; requestsPerSecond: number; transactionsPerSecond: number }

/** The README's results table, by run. */
const reportedRuns = (): ReadonlyMap<string, Reported> => {
  const lines = readme.split("\n")
  const header = lines.findIndex((line) => line.startsWith("| Run | Requests | Requests/s | Transactions/s |"))
  const rows = new Map<string, Reported>()

  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("| `")) {
      break
    }

    const [run = "", requests = "", perSecond = "", transactions = ""] = line
      .split("|")
      .slice(1, 5)
      .map((cell) => cell.trim())
    rows.set(run.replaceAll("`", ""), {
      requests: Number(requests.replaceAll(",", "")),
      requestsPerSecond: Number(perSecond),
      transactionsPerSecond: Number(transactions),
    })
  }

  return rows
}

describe("the README's load test report", () => {
  it("gives the transactions and requests per second of every run", () => {
    const reported = reportedRuns()

    expect([...reported.keys()]).toEqual(runs)

    for (const [run, row] of reported) {
      expect(row.transactionsPerSecond, run).toBeGreaterThan(0)
      expect(row.requestsPerSecond, run).toBeGreaterThanOrEqual(row.transactionsPerSecond)
    }
  })

  it("says what one transaction is, and where throughput levels off", () => {
    expect(readme).toMatch(/One step, such as "open product", is one transaction\./)
    expect(readme).toMatch(/\*\*Throughput\*\* levels off .* requests a second/)
  })
})

describe("k6's summaries", () => {
  it.each(runs)("hold the figures the README gives for the %s run", (run) => {
    const metrics = (JSON.parse(readFileSync(summaryOf(run), "utf8")) as { metrics: Record<string, { values: Record<string, number> }> })
      .metrics
    const valueOf = (metric: string, stat: string): number => metrics[metric]?.values[stat] ?? Number.NaN

    expect(reportedRuns().get(run)).toEqual({
      requests: valueOf("http_reqs", "count"),
      requestsPerSecond: Number(valueOf("http_reqs", "rate").toFixed(1)),
      transactionsPerSecond: Number(valueOf("transactions", "rate").toFixed(1)),
    })
  })
})
