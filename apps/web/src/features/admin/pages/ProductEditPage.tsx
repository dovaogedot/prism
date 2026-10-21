import type { AdminBrand, AdminCategory, AdminProductDetail, ProductInput } from "@prism/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";
import { ProductForm } from "../components/ProductForm.tsx";
import { ProductImages } from "../components/ProductImages.tsx";
import { Cents } from "../forms.ts";

/**
 * A product's admin page: a new one at `/admin/products/new`, which goes on
 * to its own page once saved so pictures can be added, or an existing one,
 * with its pictures and the way to delete it.
 */
export const ProductEditPage = () => {
  const { id = "new" } = useParams();

  const navigate = useNavigate();

  const isNew = id === "new";

  const product = useAdminRead<AdminProductDetail>(AdminKeys.one("products", id), `/products/${id}`, !isNew);

  const categories = useAdminRead<{ items: readonly AdminCategory[] }>(AdminKeys.list("categories", ""), "/categories");

  const brands = useAdminRead<{ items: readonly AdminBrand[] }>(AdminKeys.list("brands", ""), "/brands");

  const [isDeleting, setDeleting] = useState(false);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const create = useAdminWrite((input: ProductInput) => Api.post<AdminProductDetail>("/admin/products", input));

  const update = useAdminWrite((input: ProductInput) => Api.put<AdminProductDetail>(`/admin/products/${id}`, input));

  const remove = useAdminWrite(() => Api.requestEmpty(`/admin/products/${id}`, { method: "DELETE" }));

  const back = (
    <Link className="text-sm font-medium text-accent underline-offset-2 hover:underline" to="/admin/products">
      All products
    </Link>
  );

  const lists = categories.data !== undefined && brands.data !== undefined ? { categories: categories.data.items, brands: brands.data.items } : undefined;

  if (isNew) {
    return (
      <AdminPage text={PageText.adminProductNew} heading="New product" actions={back}>
        {lists === undefined ? (
          <Skeleton className="h-96 w-full" />
        ) : (
          <ProductForm
            categories={lists.categories}
            brands={lists.brands}
            submitLabel="Create product"
            onSave={async (input) => {
              const created = await create.mutateAsync(input);
              Toast.show(`${created.name} is created. Add its pictures next.`);
              void navigate(`/admin/products/${created.id}`, { replace: true });
            }}
          />
        )}
      </AdminPage>
    );
  }

  return match({ product, lists })
    .with({ product: { status: "error" } }, ({ product: { error } }) => (
      <AdminPage text={PageText.adminProductEdit} heading="Product not found" actions={back}>
        <Alert>{Failure.message(error)}</Alert>
      </AdminPage>
    ))
    .with(P.union({ product: { data: P.nullish } }, { lists: P.nullish }), () => (
      <AdminPage text={PageText.adminProductEdit} heading="Product" actions={back}>
        <Skeleton className="h-96 w-full" />
      </AdminPage>
    ))
    .otherwise(({ product: { data } }) => {
      if (data === undefined || lists === undefined) return null;

      return (
        <AdminPage text={{ ...PageText.adminProductEdit, title: `${data.name} - Admin` }} heading={data.name} actions={back}>
          {failure === undefined ? null : <Alert>{failure}</Alert>}
          <p className="text-sm">
            <Link className="text-accent underline underline-offset-2" to={`/products/${data.slug}`}>
              See it in the shop
            </Link>
          </p>

          <ProductForm
            key={data.updatedAt}
            initial={{
              name: data.name,
              slug: data.slug,
              description: data.description,
              price: Cents.toEuros(data.priceCents),
              stock: data.stock,
              categoryId: data.categoryId,
              brandId: data.brandId,
              weightGrams: data.weightGrams,
              widthMm: data.widthMm,
              heightMm: data.heightMm,
              depthMm: data.depthMm,
              properties: [...data.properties],
              isFeatured: data.isFeatured,
            }}
            categories={lists.categories}
            brands={lists.brands}
            submitLabel="Save product"
            onSave={async (input) => {
              await update.mutateAsync(input);
              Toast.show(`${input.name} is saved.`);
            }}
          />

          <ProductImages productId={data.id} images={data.images} />

          <div className="border-t border-line pt-6">
            <Button tone="danger" type="button" onClick={() => setDeleting(true)}>
              Delete product
            </Button>
          </div>

          <ConfirmDialog
            isOpen={isDeleting}
            title={`Delete ${data.name}?`}
            confirmLabel="Delete product"
            isBusy={remove.isPending}
            onCancel={() => setDeleting(false)}
            onConfirm={() =>
              remove.mutate(undefined, {
                onSuccess: () => {
                  Toast.show(`${data.name} is deleted.`);
                  void navigate("/admin/products", { replace: true });
                },
                onError: (reason) => {
                  setDeleting(false);
                  setFailure(Failure.message(reason));
                },
              })
            }
          >
            It leaves the shop with its pictures and reviews. Orders that bought it keep their lines, with its name and price.
          </ConfirmDialog>
        </AdminPage>
      );
    });
};
