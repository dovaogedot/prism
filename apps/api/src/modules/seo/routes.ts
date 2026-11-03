/**
 * What search engines read: `robots.txt`, which keeps them out of private
 * pages and names the sitemap, and `sitemap.xml`, which lists every public
 * page with its absolute address. The web container serves both at the
 * site's root. And whether a product's or a category's page has one to show,
 * which the web container asks before it answers that page, so that a page
 * of an unknown slug answers with status 404.
 */

import { Slug } from "@prism/shared"
import { asc, eq } from "drizzle-orm"
import type { FastifyInstance } from "fastify"
import type { Database } from "../../db/client.ts"
import { categories, products } from "../../db/schema.ts"
import { HttpErrors } from "../../http/errors.ts"
import { Html } from "../../http/html.ts"

/** What the SEO routes are served from. */
export type SeoRouteDependencies = Readonly<{ db: Database; webOrigin: string }>

/** One address of the sitemap, with when it last changed when that is known. */
export type SitemapEntry = Readonly<{ path: string; lastModified?: Date }>

/** The sections of the storefront whose pages show one product or one category, named by its slug. */
export type PageSection = "products" | "categories"

export const SeoRoutes = {
  /** Pages nobody should find through a search engine: they are personal, or empty without a session. */
  PRIVATE: [
    "/cart",
    "/checkout",
    "/orders",
    "/account",
    "/admin",
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/search",
    "/api/",
  ],

  /** The fixed pages every sitemap lists. */
  FIXED: ["/", "/shop", "/about", "/contact", "/faq", "/terms", "/privacy"],

  /** The sections whose pages the web container asks about. */
  PAGE_SECTIONS: ["products", "categories"] as const satisfies readonly PageSection[],

  robots: (webOrigin: string): string =>
    ["User-agent: *", ...SeoRoutes.PRIVATE.map((path) => `Disallow: ${path}`), "", `Sitemap: ${webOrigin}/sitemap.xml`, ""].join("\n"),

  sitemap: (webOrigin: string, entries: readonly SitemapEntry[]): string =>
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries.map(
        (entry) =>
          `  <url><loc>${Html.escape(`${webOrigin}${entry.path}`)}</loc>${
            entry.lastModified === undefined ? "" : `<lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>`
          }</url>`,
      ),
      "</urlset>",
      "",
    ].join("\n"),

  /** Every public address: the fixed pages, each category and each product. */
  entries: async (db: Database): Promise<readonly SitemapEntry[]> => {
    const [shelves, items] = await Promise.all([
      db.select({ slug: categories.slug }).from(categories).orderBy(asc(categories.slug)),
      db.select({ slug: products.slug, updatedAt: products.updatedAt }).from(products).orderBy(asc(products.slug)),
    ])
    const pathOf = (prefix: string, slug: Slug) => `${prefix}/${slug}`

    return [
      ...SeoRoutes.FIXED.map((path) => ({ path })),
      ...shelves.map((shelf) => ({ path: pathOf("/categories", shelf.slug) })),
      ...items.map((item) => ({ path: pathOf("/products", item.slug), lastModified: item.updatedAt })),
    ]
  },

  /** Whether the shop has the product or category whose page `section`/`text` is. A text that is no slug names none. */
  hasPage: async (db: Database, section: PageSection, text: string): Promise<boolean> => {
    const slug = Slug.schema.safeParse(text)
    if (!slug.success) return false

    const found =
      section === "products"
        ? await db.select({ slug: products.slug }).from(products).where(eq(products.slug, slug.data)).limit(1)
        : await db.select({ slug: categories.slug }).from(categories).where(eq(categories.slug, slug.data)).limit(1)
    return found.length > 0
  },

  register: (app: FastifyInstance, deps: SeoRouteDependencies): void => {
    const shared = { cache: "public" } as const

    app.get("/seo/robots.txt", { config: shared }, async (_request, reply) =>
      reply.type("text/plain; charset=utf-8").send(SeoRoutes.robots(deps.webOrigin)),
    )

    app.get("/seo/sitemap.xml", { config: shared }, async (_request, reply) =>
      reply.type("application/xml; charset=utf-8").send(SeoRoutes.sitemap(deps.webOrigin, await SeoRoutes.entries(deps.db))),
    )

    // The web server asks before it answers a product's or a category's page, so an unknown slug gets status 404.
    for (const section of SeoRoutes.PAGE_SECTIONS) {
      app.get<{ Params: { slug: string } }>(`/seo/pages/${section}/:slug`, { config: shared }, async (request, reply) =>
        (await SeoRoutes.hasPage(deps.db, section, request.params.slug))
          ? reply.status(204).send()
          : HttpErrors.send(reply, { _tag: section === "products" ? "ProductNotFound" : "CategoryNotFound" }),
      )
    }
  },
} as const
