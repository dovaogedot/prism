/**
 * The web server answers with the app only at the addresses of its pages,
 * and with status 404 everywhere else. The router and the Caddyfile's `@app`
 * pattern each list the pages, so every page of the router has to match the
 * pattern, and every page the pattern names has to be in the router.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), "utf8")

/** The `@app` pattern's alternatives: the paths it answers, without their leading slash. */
const source = /@app path_regexp \^\/\((.+)\)\/\?\$/.exec(read("../Caddyfile"))?.[1] ?? ""
const pattern = new RegExp(`^/(${source})/?$`)

/** A path with every parameter, and every pattern a parameter stands for, filled in by one sample value. */
const sampled = (path: string): string =>
  path
    .replaceAll(/:[a-zA-Z]+/g, "sample-1")
    .replaceAll("[^/]+", "sample-1")
    .replaceAll("[a-z0-9-]+", "sample-1")

/** The `path` of every route in a route file, under `prefix`, without the catch-all. */
const routesOf = (file: string, prefix: string): readonly string[] =>
  [...read(file).matchAll(/path: "([^"]+)"/g)]
    .map((found) => found[1] ?? "")
    .filter((path) => path !== "*" && path !== "/" && path !== "admin")
    .map((path) => `${prefix}${path}`)

const pages = ["", "admin", ...routesOf("../src/app/main.tsx", ""), ...routesOf("../src/app/admin-routes.ts", "admin/")].map(sampled)

/** Splits a group's alternatives at its own level, leaving nested groups whole. */
const alternativesOf = (group: string): readonly string[] => {
  const found: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < group.length; index += 1) {
    const character = group[index]
    if (character === "(") depth += 1
    if (character === ")") depth -= 1
    if (character === "|" && depth === 0) {
      found.push(group.slice(start, index))
      start = index + 1
    }
  }

  return [...found, group.slice(start)]
}

/** Every path the pattern names: a section with an optional group of sub-pages, such as admin's, counts each one. */
const named = alternativesOf(source).flatMap((alternative) => {
  const nested = /^([a-z/-]+)\(\/\((.+)\)\)\?$/.exec(alternative)
  if (nested === null) return [sampled(alternative)]

  const [, section = "", children = ""] = nested
  return [section, ...alternativesOf(children).map((child) => sampled(`${section}/${child}`))]
})

describe("the pages the web server answers with the app", () => {
  it("include every page of the router", () => {
    expect(pages.filter((page) => !pattern.test(`/${page}`))).toEqual([])
  })

  it("are all pages of the router", () => {
    expect(named.filter((path) => !pages.includes(path))).toEqual([])
  })

  it("leave out an address that is no page", () => {
    for (const path of ["/no-such-page", "/admin/no-such-section", "/products/Not_A_Slug", "/account/elsewhere"])
      expect(pattern.test(path), path).toBe(false)
  })
})
