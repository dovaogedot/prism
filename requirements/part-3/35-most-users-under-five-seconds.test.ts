/**
 * REQUIREMENTS_3.md: "Load test report identifies maximum concurrent users
 * before response times exceed 5 seconds."
 *
 * The README's report is checked against its own table always, and against
 * the stress run's raw samples when `loadtest/results` holds them, which a
 * load run leaves on the machine that ran it.
 */

import { createReadStream, existsSync, readFileSync } from "node:fs"
import { createInterface } from "node:readline"
import { describe, expect, it } from "vitest"
import { StressSteps } from "../../loadtest/lib/steps.ts"

const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8")
const samples = new URL("../../loadtest/results/stress-samples.csv", import.meta.url)

/** A step of the stress run as k6's samples give it: its users, its p95 in milliseconds, and its share of failed requests. */
type Step = { users: number; p95: number; errors: number }

/** A row of the README's table: the steps from `fewest` to `most` users, whose p95 lay from `low` to `high` milliseconds. */
type Row = { fewest: number; most: number; low: number; high: number }

/** A number as the README writes it, such as `1,000`. */
const numberOf = (text: string): number => Number(text.replaceAll(",", ""))

/** The README's table of the p95 held at each step, where a row such as `25 to 300 | 14 to 24 ms` covers several. */
const reportedRows = (): readonly Row[] => {
  const start = readme.indexOf("**Most users before 5 seconds.**")
  const table = readme.slice(start).split("\n\n")[1] ?? ""

  return table
    .split("\n")
    .slice(2)
    .map((line) => {
      const [users = "", p95 = ""] = line
        .split("|")
        .slice(1, 3)
        .map((cell) => cell.trim())
      const [fewest = "", most = fewest] = users.split(" to ")
      const scale = p95.endsWith(" ms") ? 1 : 1000
      const [low = "", high = low] = p95.replace(/ m?s$/, "").split(" to ")

      return { fewest: numberOf(fewest), most: numberOf(most), low: numberOf(low) * scale, high: numberOf(high) * scale }
    })
}

/** The most users the README says stayed under 5 seconds, and the users of the next step, which did not. */
const reportedLimit = (): readonly [number, number] => {
  const found = /([\d,]+) users stay under 5 seconds for the whole minute held at their step, and ([\d,]+) do not/.exec(readme)

  return [numberOf(found?.[1] ?? "0"), numberOf(found?.[2] ?? "0")]
}

/**
 * Each step's p95 and error rate over the minute it held its users, read
 * from k6's samples. The ramp to a step is left out: most of it runs below
 * the step's users.
 */
const measuredSteps = async (): Promise<readonly Step[]> => {
  const lines = createInterface({ input: createReadStream(samples) })
  const kept: string[][] = []
  let start = Number.POSITIVE_INFINITY

  for await (const line of lines) {
    const [metric = "", second = "", value = ""] = line.split(",", 3)

    if (metric === "vus") {
      start = Math.min(start, Number(second))
    }

    if (metric === "http_req_duration" || metric === "http_req_failed") {
      kept.push([metric, second, value])
    }
  }

  const period = StressSteps.RAMP_SECONDS + StressSteps.HOLD_SECONDS
  const held = StressSteps.TARGETS.map(() => ({ durations: [] as number[], failures: 0, requests: 0 }))

  for (const [metric, second, value] of kept) {
    const offset = Number(second) - start
    const step = held[Math.floor(offset / period)]

    if (offset < 0 || step === undefined || offset % period < StressSteps.RAMP_SECONDS) {
      continue
    }

    if (metric === "http_req_duration") {
      step.durations.push(Number(value))
    } else {
      step.requests += 1
      step.failures += Number(value)
    }
  }

  return held.map((step, index) => {
    const sorted = step.durations.toSorted((a, b) => a - b)

    return {
      users: StressSteps.TARGETS[index] ?? 0,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? 0,
      errors: step.requests === 0 ? 0 : step.failures / step.requests,
    }
  })
}

describe("the README's load test report", () => {
  it("names the most users served before p95 passed 5 seconds, and its own table bears it out", () => {
    const [most, next] = reportedLimit()
    const rows = reportedRows()

    expect(most).toBeGreaterThan(0)
    expect(rows.filter((row) => row.most <= most).every((row) => row.high < 5000)).toBe(true)
    expect(rows.find((row) => row.fewest === next)?.low).toBeGreaterThanOrEqual(5000)
    expect(Math.max(...rows.filter((row) => row.most < next).map((row) => row.most))).toBe(most)
  })

  it.runIf(existsSync(samples))(
    "agrees with the stress run's samples: the same most users, and the p95 of every step it lists",
    { timeout: 300_000 },
    async () => {
      const measured = await measuredSteps()
      const served = measured.filter((step) => step.p95 < 5000 && step.errors < 0.05)

      expect(Math.max(...served.map((step) => step.users))).toBe(reportedLimit()[0])

      for (const row of reportedRows()) {
        const p95s = measured.filter((step) => step.users >= row.fewest && step.users <= row.most).map((step) => step.p95)
        // The README rounds to whole milliseconds below a second, and to a tenth of a second above.
        const tolerance = row.high < 1000 ? 0.5 : 50

        expect(p95s.length, `${row.fewest} users`).toBeGreaterThan(0)
        expect(Math.abs(Math.min(...p95s) - row.low), `${row.fewest} users`).toBeLessThanOrEqual(tolerance)
        expect(Math.abs(Math.max(...p95s) - row.high), `${row.most} users`).toBeLessThanOrEqual(tolerance)
      }
    },
  )
})
