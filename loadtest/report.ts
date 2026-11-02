/**
 * Turns one load run's results into the tables of the README's performance
 * report: the k6 summary, every container's peak CPU and memory from the
 * stats samples, and Postgres's costliest statements. For the stress
 * run, also the response times of each step's ramp and held minute, from
 * k6's own samples, and the most users a held minute served before p95
 * passed 5 seconds. Prints the tables, and
 * writes them beside the results as `<run>.md`.
 *
 *   node loadtest/report.ts baseline|normal|peak|stress
 */

import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs"
import { StringDecoder } from "node:string_decoder"
import { StressSteps } from "./lib/steps.ts"

/** The part of k6's end-of-run summary the report reads. */
type Summary = Readonly<{ metrics: Readonly<Record<string, Readonly<{ values: Readonly<Record<string, number>> }>>> }>

/** A container's highest CPU and memory over the run. */
type Peak = { cpu: number; memory: number; memoryText: string; limitText: string; memoryShare: number }

const Report = {
  RESULTS: new URL("./results/", import.meta.url),
  /** The response time past which a step no longer counts as served. */
  LIMIT_MS: 5000,

  read: (file: string): string | undefined => {
    const url = new URL(file, Report.RESULTS)
    return existsSync(url) ? readFileSync(url, "utf8") : undefined
  },

  /** The lines of a results file that exists, read a chunk at a time, so a file of any size fits in memory. */
  readLines: function* (file: string): Generator<string> {
    const descriptor = openSync(new URL(file, Report.RESULTS), "r")
    const chunk = Buffer.alloc(1 << 20)
    // Keeps a character whose bytes a chunk boundary splits until the rest of it arrives.
    const decoder = new StringDecoder("utf8")
    let rest = ""

    try {
      for (let size = readSync(descriptor, chunk); size > 0; size = readSync(descriptor, chunk)) {
        const lines = (rest + decoder.write(chunk.subarray(0, size))).split("\n")
        rest = lines.pop() ?? ""
        yield* lines
      }
    } finally {
      closeSync(descriptor)
    }
    yield rest + decoder.end()
  },

  /** The fields of one CSV line, with quoted fields unquoted. */
  fields: (line: string): string[] => {
    const fields: string[] = []
    let field = ""
    let isQuoted = false

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index]
      if (isQuoted && char === '"' && line[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        isQuoted = !isQuoted
      } else if (char === "," && !isQuoted) {
        fields.push(field)
        field = ""
      } else {
        field += char
      }
    }
    fields.push(field)
    return fields
  },

  /** A size such as `312.4MiB` or `1.2GiB`, in mebibytes. */
  mebibytes: (text: string): number => {
    const match = /([\d.]+)\s*([KMG]i?B|B)/.exec(text)
    if (match === null) return 0

    const units: Readonly<Record<string, number>> = { B: 1 / 1048576, KiB: 1 / 1024, KB: 1 / 1024, MiB: 1, MB: 1, GiB: 1024, GB: 1024 }
    return Number(match[1]) * (units[match[2] ?? "MiB"] ?? 1)
  },

  table: (header: readonly string[], rows: readonly (readonly (string | number)[])[]): string =>
    [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n"),

  percentile: (sorted: readonly number[], share: number): number =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0,

  summary: (run: string): string => {
    const text = Report.read(`${run}.json`)
    if (text === undefined) return `No summary for ${run}: run it first.`

    const summary = JSON.parse(text) as Summary
    const value = (metric: string, stat: string): number => summary.metrics[metric]?.values[stat] ?? 0
    const ms = (stat: string): string => `${Math.round(value("http_req_duration", stat))} ms`

    return Report.table(
      ["Users", "Requests", "Requests/s", "Steps/s", "p50", "p90", "p95", "p99", "Errors", "Steps successful"],
      [
        [
          value("vus_max", "max"),
          value("http_reqs", "count"),
          value("http_reqs", "rate").toFixed(1),
          value("transactions", "rate").toFixed(1),
          ms("med"),
          ms("p(90)"),
          ms("p(95)"),
          ms("p(99)"),
          `${(value("http_req_failed", "rate") * 100).toFixed(2)}%`,
          `${(value("transaction_success", "rate") * 100).toFixed(2)}%`,
        ],
      ],
    )
  },

  containers: (run: string): string => {
    const text = Report.read(`stats-${run}.csv`)
    if (text === undefined) return `No container samples for ${run}.`

    const peaks = new Map<string, Peak>()
    for (const line of text.split("\n")) {
      const [, name, cpu, usage, share] = Report.fields(line.trim())
      if (name === undefined || cpu === undefined || usage === undefined || share === undefined || !cpu.endsWith("%")) continue

      const [used = "", limit = ""] = usage.split("/").map((part) => part.trim())
      const peak = peaks.get(name) ?? { cpu: 0, memory: 0, memoryText: used, limitText: limit, memoryShare: 0 }
      peak.cpu = Math.max(peak.cpu, Number.parseFloat(cpu))
      if (Report.mebibytes(used) >= peak.memory) {
        peak.memory = Report.mebibytes(used)
        peak.memoryText = used
        peak.memoryShare = Number.parseFloat(share)
      }
      peaks.set(name, peak)
    }

    return Report.table(
      ["Container", "Peak CPU (100% is one core)", "Peak memory", "Of its limit"],
      [...peaks.entries()]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([name, peak]) => [name, `${peak.cpu.toFixed(0)}%`, peak.memoryText, `${peak.memoryShare.toFixed(0)}% of ${peak.limitText}`]),
    )
  },

  queries: (run: string): string => {
    const text = Report.read(`queries-${run}.csv`)
    if (text === undefined) return `No statement costs for ${run}.`

    const [, ...rows] = text.trim().split("\n").map(Report.fields)
    return Report.table(
      ["Calls", "Total ms", "Mean ms", "Statement"],
      rows.map(([calls = "", total = "", mean = "", query = ""]) => [calls, total, mean, `\`${query.replaceAll("|", "\\|")}\``]),
    )
  },

  /**
   * The stress run's response times and errors over each step's ramp and
   * held minute, and the most users a held minute served within 5 s. A ramp
   * never counts: most of its time is spent below its step's users.
   */
  steps: (): string => {
    const file = "stress-samples.csv"
    if (!existsSync(new URL(file, Report.RESULTS))) return "No samples: the stress run writes them."

    const [header = ""] = Report.readLines(file)
    const columns = Report.fields(header)
    const at = (name: string): number => columns.indexOf(name)

    // The scenario begins with its first count of users; the setup's requests come before it.
    let start = Number.POSITIVE_INFINITY
    for (const line of Report.readLines(file)) {
      const fields = Report.fields(line)
      if (fields[at("metric_name")] === "vus") start = Math.min(start, Number(fields[at("timestamp")]))
    }

    const period = StressSteps.RAMP_SECONDS + StressSteps.HOLD_SECONDS
    // Stage 2n is the ramp to step n, and stage 2n + 1 holds it.
    const stages = new Map<number, { durations: number[]; failures: number; requests: number }>()

    for (const line of Report.readLines(file)) {
      const fields = Report.fields(line)
      const metric = fields[at("metric_name")]
      const second = Number(fields[at("timestamp")])
      const value = Number(fields[at("metric_value")])
      if (metric === undefined || Number.isNaN(second) || second < start) continue

      const offset = second - start
      const step = Math.floor(offset / period)
      if (step >= StressSteps.TARGETS.length) continue

      const index = step * 2 + (offset % period < StressSteps.RAMP_SECONDS ? 0 : 1)
      const stage = stages.get(index) ?? { durations: [], failures: 0, requests: 0 }
      if (metric === "http_req_duration") stage.durations.push(value)
      if (metric === "http_req_failed") {
        stage.requests += 1
        stage.failures += value
      }
      stages.set(index, stage)
    }

    const rows = [...stages.entries()]
      .toSorted(([a], [b]) => a - b)
      .map(([index, stage]) => {
        const users = StressSteps.TARGETS[Math.floor(index / 2)] ?? 0
        const isHeld = index % 2 === 1

        return {
          label: isHeld ? `Held at ${users}` : `Ramp to ${users}`,
          users,
          isHeld,
          p95: Report.percentile(
            stage.durations.toSorted((a, b) => a - b),
            0.95,
          ),
          errors: stage.requests === 0 ? 0 : stage.failures / stage.requests,
        }
      })
    const served = rows.filter((row) => row.isHeld && row.p95 < Report.LIMIT_MS && row.errors < 0.05)
    const most = Math.max(0, ...served.map((row) => row.users))

    return [
      Report.table(
        ["Stage", "p95", "Errors"],
        rows.map((row) => [row.label, `${Math.round(row.p95)} ms`, `${(row.errors * 100).toFixed(2)}%`]),
      ),
      "",
      `The most users a held minute served with p95 under 5 seconds and errors under 5%: ${most}.`,
    ].join("\n")
  },

  main: (run: string | undefined): void => {
    if (run === undefined || !["baseline", "normal", "peak", "stress"].includes(run)) {
      console.error("Usage: node loadtest/report.ts baseline|normal|peak|stress")
      process.exitCode = 2
      return
    }

    const report = [
      `### The ${run} run`,
      "",
      Report.summary(run),
      "",
      "Containers:",
      "",
      Report.containers(run),
      "",
      "Costliest statements:",
      "",
      Report.queries(run),
      ...(run === "stress" ? ["", "Step by step:", "", Report.steps()] : []),
      "",
    ].join("\n")

    writeFileSync(new URL(`${run}.md`, Report.RESULTS), report)
    console.log(report)
  },
} as const

Report.main(process.argv[2])
