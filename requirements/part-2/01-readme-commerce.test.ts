/**
 * REQUIREMENTS_2.md: "The README file contains updated project overview,
 * entity relationship diagram, setup instructions, and usage guide for the
 * commerce functionality"
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string): string => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8")

const readme = read("README.md")

/** The README's text under `heading`, up to the next heading of the same level or a higher one. */
const sectionOf = (heading: string): string => {
  const level = /^#+/.exec(heading)?.[0].length ?? 0
  const lines = readme.split("\n")
  const start = lines.indexOf(heading)
  if (start === -1) throw new Error(`The README has no heading "${heading}".`)

  const end = lines.findIndex((line, index) => index > start && /^#+ /.test(line) && (/^#+/.exec(line)?.[0].length ?? 0) <= level)

  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n")
}

/** The tables the schema declares, by their names in Postgres. */
const schemaTables = [...read("apps/api/src/db/schema.ts").matchAll(/pgTable\(\s*"([a-z_]+)"/g)].map((match) => match[1])

const COMMERCE_TABLES = ["cart", "cart_item", "customer_order", "order_line", "order_event", "payment", "shipping_method"]

describe("the overview", () => {
  it("describes the cart, checkout, payments and orders", () => {
    const overview = readme.slice(0, readme.indexOf("\n## "))

    expect(overview).toMatch(/keep a cart as guests or members/)
    expect(overview).toMatch(/check out on one page with card payments through Stripe/)
    expect(overview).toMatch(/follow and cancel their orders/)
    expect(overview).toMatch(/RabbitMQ between the order and payment services/)
  })
})

describe("the entity relationship diagram", () => {
  const diagram = read("docs/erd.mmd")
  const picture = read("docs/erd.svg")

  it("is shown in the README", () => {
    expect(sectionOf("## Entity relationship diagram")).toMatch(/\]\(docs\/erd\.svg\)/)
  })

  it("draws every table the schema has, the commerce tables among them", () => {
    expect(schemaTables).toEqual(expect.arrayContaining(COMMERCE_TABLES))

    for (const table of schemaTables) {
      expect(diagram, table).toMatch(new RegExp(`^  ${table} \\{$`, "m"))
      expect(picture, table).toContain(`>${table}<`)
    }
  })

  it("relates carts to accounts and products, and orders to their lines, events and payments", () => {
    for (const relationship of [
      /^ {2}app_user \|\|--.. cart : /m,
      /^ {2}cart \|\|--o\{ cart_item : /m,
      /^ {2}product \|\|--o\{ cart_item : /m,
      /^ {2}app_user \|\|--o\{ customer_order : /m,
      /^ {2}customer_order \|\|--o\{ order_line : /m,
      /^ {2}customer_order \|\|--o\{ order_event : /m,
      /^ {2}customer_order \|\|--o\{ payment : /m,
      /^ {2}shipping_method \|\|--o\{ customer_order : /m,
    ]) {
      expect(diagram).toMatch(relationship)
    }
  })
})

describe("the setup instructions", () => {
  it("say how to turn on test payments, and how webhooks reach the API", () => {
    const setup = sectionOf("### Taking test payments")

    expect(setup).toMatch(/STRIPE_SECRET_KEY/)
    expect(setup).toMatch(/STRIPE_PUBLISHABLE_KEY/)
    expect(setup).toMatch(/stripe listen --forward-to/)
    expect(setup).toMatch(/PAYMENTS_MODE=simulated/)
  })
})

describe("the usage guide", () => {
  it("covers the cart, checkout and orders", () => {
    const usage = sectionOf("## Usage")

    expect(usage).toMatch(/^### Cart$/m)
    expect(usage).toMatch(/^### Checkout$/m)
    expect(usage).toMatch(/^### Orders$/m)
  })

  it("lists Stripe's test cards and what each one does", () => {
    const checkout = sectionOf("### Checkout")

    expect(checkout).toMatch(/`4242 4242 4242 4242` \| Paid/)
    expect(checkout).toMatch(/`4000 0000 0000 9995` \| Declined: insufficient funds/)
  })
})
