/**
 * What the part-2 browser checks set up through the API before a page opens:
 * products to buy, and a cart that holds them. The cart belongs to the
 * browser context whose `request` added to it.
 */

import { expect, type APIRequestContext } from "@playwright/test"

/** A product as the shop's listing serves it. */
export type ListedProduct = Readonly<{
  id: string
  slug: string
  name: string
  priceCents: number
  stock: number
  images: readonly Readonly<{ url: string }>[]
}>

/** A delivery option as checkout offers it. */
export type DeliveryOption = Readonly<{ code: string; name: string; priceCents: number; freeFromCents?: number }>

export const Storefront = {
  /** A price as the shop writes it, such as "€16.00". */
  euros: (cents: number): string => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(cents / 100),

  /**
   * `count` listed products with a picture, at least `minStock` in stock and
   * names of their own, so a page shows each one once.
   */
  findProducts: async (request: APIRequestContext, count: number, minStock: number): Promise<readonly ListedProduct[]> => {
    const answer = await request.get("/api/v1/products?perPage=60")
    expect(answer.status(), await answer.text()).toBe(200)

    const { items } = (await answer.json()) as Readonly<{ items: readonly ListedProduct[] }>
    const names = new Set<string>()
    const chosen = items.filter((product) => {
      if (product.images.length === 0 || product.stock < minStock || names.has(product.name)) return false
      names.add(product.name)
      return true
    })
    expect(chosen.length, "products with a picture and enough stock").toBeGreaterThanOrEqual(count)

    return chosen.slice(0, count)
  },

  /** Adds `quantity` of `product` to the cart of `request`'s browser context. */
  addToCart: async (request: APIRequestContext, product: ListedProduct, quantity: number): Promise<void> => {
    const answer = await request.post("/api/v1/cart/items", { data: { productId: product.id, quantity } })
    expect(answer.status(), await answer.text()).toBe(200)
  },

  /** The delivery options checkout offers, in its order. */
  findDeliveryOptions: async (request: APIRequestContext): Promise<readonly DeliveryOption[]> => {
    const answer = await request.get("/api/v1/shipping-methods")
    expect(answer.status(), await answer.text()).toBe(200)

    return ((await answer.json()) as Readonly<{ items: readonly DeliveryOption[] }>).items
  },

  /** What `option` costs for a cart of `subtotalCents`: nothing from its free shipping threshold on. */
  shippingCentsOf: (option: DeliveryOption, subtotalCents: number): number =>
    option.freeFromCents !== undefined && subtotalCents >= option.freeFromCents ? 0 : option.priceCents,

  /** What `option` costs for a cart of `subtotalCents`, as checkout writes it. */
  shippingText: (option: DeliveryOption, subtotalCents: number): string => {
    const cents = Storefront.shippingCentsOf(option, subtotalCents)
    return cents === 0 ? "Free" : Storefront.euros(cents)
  },
} as const
