/**
 * REQUIREMENTS_3.md: "Project application is containerized using Docker.
 *
 *   The project uses Docker to containerize the application and its
 *   dependencies. Host prerequisites are limited to Docker and payment
 *   simulation CLI - all other dependencies are managed within containers."
 *
 * The payment simulation CLI is Stripe's, which the stack also runs as a
 * container of its own. The start scripts are checked for the programs a
 * shop is built from and for download tools such as curl: none of them runs
 * on the host.
 */

import { existsSync, readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const fileOf = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

const compose = fileOf("docker-compose.yml")

/** Each service of `docker-compose.yml` by name, with the lines that define it. */
const services = (): ReadonlyMap<string, string> => {
  const block = compose.slice(compose.indexOf("\nservices:\n"), compose.indexOf("\nvolumes:\n"))
  const found = new Map<string, string>()
  const parts = block.split(/^ {2}([a-z0-9-]+):$/m).slice(1)

  for (let index = 0; index + 1 < parts.length; index += 2) {
    found.set(parts[index] ?? "", parts[index + 1] ?? "")
  }

  return found
}

describe("the Compose stack", () => {
  it("runs the application, its database, its message broker, its mail and Stripe's CLI as containers", () => {
    expect([...services().keys()]).toEqual(
      expect.arrayContaining(["postgres", "rabbitmq", "mailpit", "migrate", "api", "web", "stripe", "seed", "test"]),
    )
  })

  it("gives every service an image or a build from a Dockerfile in the repository", () => {
    for (const [name, definition] of services()) {
      const dockerfile = /^ {6}dockerfile: (\S+)$/m.exec(definition)?.[1]
      const image = /^ {4}image: \S+$/m.test(definition)

      expect(image || dockerfile !== undefined, name).toBe(true)

      if (dockerfile !== undefined) {
        expect(existsSync(new URL(`../../${dockerfile}`, import.meta.url)), dockerfile).toBe(true)
        expect(fileOf(dockerfile), dockerfile).toMatch(/^FROM \S+/m)
      }
    }
  })

  it("builds the API and the storefront with Node inside the image, so the host needs no Node", () => {
    expect(fileOf("apps/api/Dockerfile")).toMatch(/^FROM node:\S+ AS build$/m)
    expect(fileOf("apps/api/Dockerfile")).toMatch(/^RUN npm ci/m)
    expect(fileOf("apps/web/Dockerfile")).toMatch(/^FROM node:\S+ AS build$/m)
    expect(fileOf("apps/web/Dockerfile")).toMatch(/^RUN npm run build --workspace @prism\/web$/m)
  })

  it("forwards Stripe's webhooks with the Stripe CLI's own image", () => {
    expect(services().get("stripe")).toMatch(/^ {4}image: stripe\/stripe-cli:\S+$/m)
    expect(services().get("stripe")).toMatch(/stripe listen/)
  })
})

describe("starting it", () => {
  it("is documented as needing Docker only, with test payments needing Stripe's keys", () => {
    expect(fileOf("README.md")).toContain("Docker is the only thing a machine needs")
    expect(fileOf("README.md")).toMatch(/2\. `docker compose up --build --detach`/)
  })

  it.each(["start.sh", "start.ps1"])(
    "runs %s's language runtimes, databases and tools through Docker, and no download tool on the host",
    (script) => {
      const commands = fileOf(script)
        .split("\n")
        .filter((line) => !/^\s*#/.test(line) && !/^\s*(echo|Write-Host)\b/.test(line))
      const onHost = commands.filter(
        (line) =>
          /\b(node|npm|npx|psql|k6|openssl|stripe|caddy|rabbitmqctl|playwright)\b/.test(line) && !/docker|_compose|Compose /.test(line),
      )
      // A download tool on the host is a prerequisite too, wherever on the line it is called.
      const downloaders = commands.filter((line) => /\b(curl|curl\.exe|wget)\b/.test(line))

      expect(onHost).toEqual([])
      expect(downloaders).toEqual([])
    },
  )
})
