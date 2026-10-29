/**
 * What the browser checks read from the running stack's API to know what a
 * page should show, and the shop's own way of writing prices and slugs.
 */

import { expect, type APIRequestContext } from "@playwright/test"

/** A product as the catalog lists it. */
export type ListedProduct = {
  id: string
  slug: string
  name: string
  priceCents: number
  stock: number
  category: { slug: string; name: string }
  brand: { slug: string; name: string }
  images: { url: string; alt: string; sources: { width: number; url: string }[] }[]
  rating: { average?: number; count: number }
}

/** One value of a filter, and how many results carry it. */
export type FacetBucket = { value: string; label: string; count: number }

/** A page of the catalog's results, as `GET /products` answers it. */
export type SearchResult = {
  items: ListedProduct[]
  total: number
  page: number
  totalPages: number
  facets: { brands: FacetBucket[]; properties: { name: string; buckets: FacetBucket[] }[] }
}

export const Storefront = {
  /** A price as the shop writes it, such as €25.00. */
  formatPrice: (cents: number): string => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100),

  /** The address part the seed makes from a product's or a category's name. */
  slugify: (name: string): string =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),

  /** Reads `path` from the API and fails the test unless it answers 200. */
  fetchJson: async <T>(request: APIRequestContext, path: string): Promise<T> => {
    const answer = await request.get(`/api/v1${path}`)
    expect(answer.status(), path).toBe(200)

    return (await answer.json()) as T
  },

  /** Searches the catalog with the query string `query`. */
  search: (request: APIRequestContext, query: string): Promise<SearchResult> =>
    Storefront.fetchJson<SearchResult>(request, `/products?${query}`),

  /** Puts `quantity` of the product with `id` in the cart of `request`'s browser context. */
  addToCart: async (request: APIRequestContext, id: string, quantity = 1): Promise<void> => {
    const answer = await request.post("/api/v1/cart/items", { data: { productId: id, quantity } })
    expect(answer.status(), await answer.text()).toBe(200)
  },

  /**
   * Places an order of one product with `id` through the API, as the
   * customer whose access token is `token`, or as a guest without one, with
   * the first delivery option. Resolves to the order's id and, for a guest,
   * its key.
   */
  placeOrder: async (request: APIRequestContext, id: string, token?: string): Promise<{ orderId: string; key?: string }> => {
    const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` }
    const added = await request.post("/api/v1/cart/items", { headers, data: { productId: id, quantity: 1 } })
    expect(added.status(), await added.text()).toBe(200)

    const cart = (await (await request.get("/api/v1/cart", { headers })).json()) as { subtotalCents: number }
    const { items } = await Storefront.fetchJson<{ items: { code: string; priceCents: number; freeFromCents?: number }[] }>(
      request,
      "/shipping-methods",
    )
    const [option] = items

    if (option === undefined) {
      throw new Error("Checkout offers no delivery option.")
    }

    const isFree = option.freeFromCents !== undefined && cart.subtotalCents >= option.freeFromCents
    const placed = await request.post("/api/v1/orders", {
      headers,
      data: {
        contact: { fullName: "Mari Maasikas", email: `mari-${Date.now()}@example.com`, phone: "+372 5123 4567" },
        address: { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" },
        shippingMethod: option.code,
        expectedTotalCents: cart.subtotalCents + (isFree ? 0 : option.priceCents),
      },
    })
    expect(placed.status(), await placed.text()).toBe(201)

    return (await placed.json()) as { orderId: string; key?: string }
  },

  /** The first `count` products of the catalog that are in stock and have a picture, best rated first. */
  pickProducts: async (request: APIRequestContext, count: number): Promise<readonly ListedProduct[]> => {
    const { items } = await Storefront.search(request, "sort=rating&perPage=60")
    const picked = items.filter((item) => item.stock >= 5 && item.images.length > 0).slice(0, count)
    expect(picked).toHaveLength(count)

    return picked
  },
} as const
