import type { ProductSummary } from "@prism/shared"
import type { ReactNode } from "react"
import { ProductCard } from "./ProductCard.tsx"

/** The row's heading and its id, the products, and a link to more of them. */
export type ProductRowProps = Readonly<{
  id: string
  title: string
  products: readonly ProductSummary[]
  /** A link beside the heading, such as "See all". */
  action?: ReactNode
  /** Whether the row is the first thing on its page, whose pictures then load at once. */
  isFirst?: boolean
}>

/** A section of product cards under an h2: on the home page, and under a product. */
export const ProductRow = ({ id, title, products, action, isFirst = false }: ProductRowProps) => (
  <section className="space-y-4" aria-labelledby={id}>
    <div className="flex items-baseline justify-between gap-4">
      <h2 className="text-xl font-semibold tracking-tight text-ink" id={id}>
        {title}
      </h2>
      {action}
    </div>
    <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <li className="grid grid-cols-1" key={product.id}>
          {/* The widest grid shows four to a row. */}
          <ProductCard product={product} isPriority={isFirst && index < 4} />
        </li>
      ))}
    </ul>
  </section>
)
