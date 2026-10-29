/**
 * REQUIREMENTS_2.md: "Project application is containerized using Docker."
 *
 * Its note: "The project uses Docker to containerize the application and its
 * dependencies. Host prerequisites are limited to Docker and payment
 * simulation CLI - all other dependencies are managed within containers."
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../../", import.meta.url))
const read = (path: string): string => readFileSync(join(root, path), "utf8")

/** Each service of a compose file by name, as the lines of its block. */
const servicesOf = (path: string): ReadonlyMap<string, string> => {
  const lines = read(path).split("\n")
  const start = lines.indexOf("services:")
  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line))
  const services = new Map<string, string>()
  let current: string | undefined

  for (const line of lines.slice(start + 1, end === -1 ? undefined : end)) {
    const name = /^ {2}([a-z0-9-]+):$/.exec(line)?.[1]
    if (name !== undefined) {
      current = name
      services.set(name, "")
    } else if (current !== undefined) {
      services.set(current, `${services.get(current) ?? ""}${line}\n`)
    }
  }

  return services
}

const services = servicesOf("docker-compose.yml")
const serviceBlock = (name: string): string => services.get(name) ?? ""

describe("the stack", () => {
  it("runs the database, the message broker and the mail catcher from images", () => {
    expect(serviceBlock("postgres")).toMatch(/^ {4}image: postgres:/m)
    expect(serviceBlock("rabbitmq")).toMatch(/^ {4}image: rabbitmq:/m)
    expect(serviceBlock("mailpit")).toMatch(/^ {4}image: axllent\/mailpit:/m)
  })

  it("builds the API, its migration and the storefront from Dockerfiles in the repository", () => {
    expect(serviceBlock("api")).toMatch(/^ {6}dockerfile: apps\/api\/Dockerfile$/m)
    expect(serviceBlock("migrate")).toMatch(/^ {6}dockerfile: apps\/api\/Dockerfile$/m)
    expect(serviceBlock("web")).toMatch(/^ {6}dockerfile: apps\/web\/Dockerfile$/m)
  })

  it("gives every service an image or a build, and every Dockerfile it names starts from a base image", () => {
    for (const path of ["docker-compose.yml", "docker-compose.e2e.yml", "docker-compose.loadtest.yml"]) {
      for (const dockerfile of read(path).matchAll(/^ {6}dockerfile: (\S+)$/gm)) {
        const file = dockerfile[1] ?? ""

        expect(existsSync(join(root, file)), file).toBe(true)
        expect(read(file), file).toMatch(/^FROM \S+/m)
      }
    }

    for (const [name, block] of services) {
      expect(block, name).toMatch(/^ {4}(image|build):/m)
    }
  })

  it("runs the tests and the seed in a container of the workspace, with Node inside it", () => {
    expect(serviceBlock("test")).toMatch(/^ {6}dockerfile: Dockerfile\.test$/m)
    expect(serviceBlock("seed")).toMatch(/^ {6}dockerfile: Dockerfile\.test$/m)
    expect(read("Dockerfile.test")).toMatch(/^FROM node:/m)
    expect(read("Dockerfile.test")).toMatch(/^RUN npm ci$/m)
  })

  it("runs Stripe's CLI as a container too, which forwards the webhooks to the API", () => {
    const stripe = serviceBlock("stripe")

    expect(stripe).toMatch(/^ {4}image: stripe\/stripe-cli:/m)
    expect(stripe).toMatch(/--forward-to http:\/\/api:8080\/api\/v1\/payments\/webhook/)
  })
})

describe("the start scripts", () => {
  /**
   * The tools a host would otherwise need: a runtime, a package manager, a
   * database client, a load tester, a test runner, and an HTTP client to wait
   * for the storefront with.
   */
  const TOOL = /\b(node|npm|npx|psql|k6|playwright|vitest|tsc|stripe|curl(\.exe)?|wget)\b/

  for (const script of ["start.sh", "start.ps1"]) {
    it(`${script} runs every tool of the project inside a container`, () => {
      const outside = read(script)
        .split("\n")
        .map((line) => line.trim())
        // Comments and the lines that only print a message run nothing.
        .filter((line) => !line.startsWith("#") && !/^(echo|Write-Host|printf)\b/.test(line))
        .filter((line) => TOOL.test(line) && !/\bdocker\b|_compose\b|-(E2e|Load)Compose\b/.test(line))

      expect(outside).toEqual([])
    })
  }

  it("say that Docker is the whole prerequisite list", () => {
    expect(read("start.sh")).toMatch(/^# The entire prerequisite list for this project is Docker\.$/m)
    expect(read("README.md")).toMatch(/Docker is the only thing a machine needs/)
  })
})
