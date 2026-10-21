import { Price, type AdminBrand, type AdminCategory, type AdminProductSummary, type Page } from "@prism/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, DataTable, EmptyState, Field, ImageSet, Pagination, SelectField, Skeleton } from "../../../shared/ui/index.ts";
import { CatalogParams } from "../../catalog/filters.ts";
import { AdminKeys, useAdminRead } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/**
 * The catalog for its content managers: found by name or slug, filtered by
 * category, brand, featuring and low stock, sorted, a page at a time.
 */
export const ProductsPage = () => {
  const [params, setParams] = useSearchParams();

  const query = params.toString();

  const products = useAdminRead<Page<AdminProductSummary>>(AdminKeys.list("products", query), `/products${query.length === 0 ? "" : `?${query}`}`);

  const categories = useAdminRead<{ items: readonly AdminCategory[] }>(AdminKeys.list("categories", ""), "/categories");

  const brands = useAdminRead<{ items: readonly AdminBrand[] }>(AdminKeys.list("brands", ""), "/brands");

  const [text, setText] = useState(params.get("q") ?? "");

  const checkboxClass = "flex items-center gap-2 text-sm text-ink";

  return (
    <AdminPage
      text={PageText.adminProducts}
      heading="Products"
      actions={
        <Link className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:bg-accent-hover" to="/admin/products/new">
          New product
        </Link>
      }
    >
      <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
        <form
          className="flex flex-wrap items-end gap-3"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setParams(CatalogParams.set(params, "q", text.trim()));
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label="Name or slug" id="product-q" type="search" value={text} onChange={(event) => setText(event.target.value)} />
          </div>
          <Button type="submit" tone="quiet">
            Find
          </Button>
        </form>

        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField label="Category" id="product-category" value={params.get("category") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "category", event.target.value))}>
            <option value="">Any category</option>
            {(categories.data?.items ?? []).map((category) => (
              <option key={category.id} value={category.slug}>
                {category.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Brand" id="product-brand" value={params.get("brand") ?? ""} onChange={(event) => setParams(CatalogParams.set(params, "brand", event.target.value))}>
            <option value="">Any brand</option>
            {(brands.data?.items ?? []).map((brand) => (
              <option key={brand.id} value={brand.slug}>
                {brand.name}
              </option>
            ))}
          </SelectField>
          <SelectField label="Sort by" id="product-sort" value={params.get("sort") ?? "name"} onChange={(event) => setParams(CatalogParams.set(params, "sort", event.target.value))}>
            <option value="name">Name</option>
            <option value="newest">Newest</option>
            <option value="stock">Stock, lowest first</option>
            <option value="price">Price, lowest first</option>
          </SelectField>
        </div>

        <div className="flex flex-wrap gap-5">
          <label className={checkboxClass}>
            <input
              className="size-4 accent-[var(--color-accent)]"
              type="checkbox"
              checked={params.get("lowStock") === "true"}
              onChange={(event) => setParams(CatalogParams.set(params, "lowStock", event.target.checked ? "true" : ""))}
            />
            Low on stock (5 or fewer)
          </label>
          <label className={checkboxClass}>
            <input
              className="size-4 accent-[var(--color-accent)]"
              type="checkbox"
              checked={params.get("featured") === "true"}
              onChange={(event) => setParams(CatalogParams.set(params, "featured", event.target.checked ? "true" : ""))}
            />
            Featured on the home page
          </label>
        </div>
      </div>

      {match(products)
        .with({ status: "error" }, ({ error }) => <Alert>{error.message}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-96 w-full" />)
        .when(
          ({ data }) => data.items.length === 0,
          () => <EmptyState title="No products match these filters." />,
        )
        .otherwise(({ data }) => (
          <>
            <p className="text-sm text-ink-soft">{data.total === 1 ? "1 product" : `${data.total} products`}</p>
            <DataTable
              label="Products"
              rows={data.items}
              rowKey={(product) => product.id}
              columns={[
                {
                  key: "name",
                  header: "Product",
                  cell: (product) => (
                    <span className="flex min-w-48 items-center gap-3">
                      {product.image === undefined ? (
                        <span className="size-10 shrink-0 rounded bg-sunken" aria-hidden="true" />
                      ) : (
                        <ImageSet className="size-10 shrink-0 rounded bg-sunken object-contain" image={product.image} sizes="2.5rem" isDecorative />
                      )}
                      <span className="min-w-0">
                        <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/admin/products/${product.id}`}>
                          {product.name}
                        </Link>
                        <span className="block text-xs text-ink-soft">{product.slug}</span>
                      </span>
                    </span>
                  ),
                },
                { key: "category", header: "Category", cell: (product) => product.category.name },
                { key: "brand", header: "Brand", cell: (product) => product.brand.name },
                { key: "price", header: "Price", isNumeric: true, cell: (product) => Price.format(product.priceCents) },
                {
                  key: "stock",
                  header: "Stock",
                  isNumeric: true,
                  cell: (product) => <span className={product.stock <= 5 ? "font-semibold text-warn" : ""}>{product.stock}</span>,
                },
                { key: "featured", header: "Featured", cell: (product) => (product.isFeatured ? "Yes" : "") },
              ]}
            />
            <Pagination page={data.page} totalPages={data.totalPages} label="Product pages" onPage={(page) => setParams(CatalogParams.set(params, "page", String(page)))} />
          </>
        ))}
    </AdminPage>
  );
};
