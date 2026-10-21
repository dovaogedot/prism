import type { AdminBrand, BrandInput } from "@prism/shared";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, DataTable, Dialog, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";
import { BrandForm } from "../components/BrandForm.tsx";

/** Which form is open: none, a new brand, or the brand given. */
type Editing = Readonly<{ kind: "none" }> | Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; brand: AdminBrand }>;

/** The catalog's brands: created and changed in a dialog, and deleted once no product carries them. */
export const BrandsPage = () => {
  const brands = useAdminRead<{ items: readonly AdminBrand[] }>(AdminKeys.list("brands", ""), "/brands");

  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const [deleting, setDeleting] = useState<AdminBrand | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const create = useAdminWrite((input: BrandInput) => Api.post<AdminBrand>("/admin/brands", input));

  const update = useAdminWrite((change: Readonly<{ id: string; input: BrandInput }>) => Api.put<AdminBrand>(`/admin/brands/${change.id}`, change.input));

  const remove = useAdminWrite((id: string) => Api.requestEmpty(`/admin/brands/${id}`, { method: "DELETE" }));

  return (
    <AdminPage text={PageText.adminBrands} heading="Brands" actions={<Button onClick={() => setEditing({ kind: "new" })}>New brand</Button>}>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {match(brands)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-64 w-full" />)
        .otherwise(({ data }) => (
          <DataTable
            label="Brands"
            rows={data.items}
            rowKey={(brand) => brand.id}
            columns={[
              { key: "name", header: "Name", cell: (brand) => <span className="font-medium text-ink">{brand.name}</span> },
              { key: "slug", header: "Slug", cell: (brand) => brand.slug },
              { key: "products", header: "Products", isNumeric: true, cell: (brand) => brand.productCount },
              {
                key: "actions",
                header: "Actions",
                cell: (brand) => (
                  <span className="flex gap-1">
                    <Button tone="quiet" type="button" onClick={() => setEditing({ kind: "existing", brand })} aria-label={`Edit ${brand.name}`}>
                      Edit
                    </Button>
                    {brand.productCount === 0 ? (
                      <Button tone="ghost" type="button" onClick={() => setDeleting(brand)} aria-label={`Delete ${brand.name}`}>
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        ))}

      <p className="text-sm text-ink-soft">A brand that products carry cannot be deleted. Give those products another brand first.</p>

      <Dialog isOpen={editing.kind !== "none"} title={editing.kind === "existing" ? `Edit ${editing.brand.name}` : "New brand"} onClose={() => setEditing({ kind: "none" })}>
        {editing.kind === "none" ? null : (
          <BrandForm
            key={editing.kind === "existing" ? editing.brand.id : "new"}
            {...(editing.kind === "existing" ? { initial: editing.brand } : {})}
            onCancel={() => setEditing({ kind: "none" })}
            onSave={async (input) => {
              if (editing.kind === "existing") {
                await update.mutateAsync({ id: editing.brand.id, input });
              } else {
                await create.mutateAsync(input);
              }
              setEditing({ kind: "none" });
              Toast.show(`${input.name} is saved.`);
            }}
          />
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={deleting !== undefined}
        title={`Delete ${deleting?.name ?? "this brand"}?`}
        confirmLabel="Delete brand"
        isBusy={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting === undefined) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              Toast.show(`${deleting.name} is deleted.`);
              setDeleting(undefined);
            },
            onError: (reason) => {
              setFailure(Failure.message(reason));
              setDeleting(undefined);
            },
          });
        }}
      >
        No product carries it, so nothing else changes.
      </ConfirmDialog>
    </AdminPage>
  );
};
