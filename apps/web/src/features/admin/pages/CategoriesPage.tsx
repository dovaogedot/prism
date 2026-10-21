import type { AdminCategory, CategoryInput } from "@prism/shared";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, DataTable, Dialog, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";
import { CategoryForm } from "../components/CategoryForm.tsx";

/** Which form is open: none, a new category, or the category given. */
type Editing = Readonly<{ kind: "none" }> | Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; category: AdminCategory }>;

/** The catalog's categories: created and changed in a dialog, and deleted once no product is filed under them. */
export const CategoriesPage = () => {
  const categories = useAdminRead<{ items: readonly AdminCategory[] }>(AdminKeys.list("categories", ""), "/categories");

  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const [deleting, setDeleting] = useState<AdminCategory | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const create = useAdminWrite((input: CategoryInput) => Api.post<AdminCategory>("/admin/categories", input));

  const update = useAdminWrite((change: Readonly<{ id: string; input: CategoryInput }>) => Api.put<AdminCategory>(`/admin/categories/${change.id}`, change.input));

  const remove = useAdminWrite((id: string) => Api.requestEmpty(`/admin/categories/${id}`, { method: "DELETE" }));

  return (
    <AdminPage text={PageText.adminCategories} heading="Categories" actions={<Button onClick={() => setEditing({ kind: "new" })}>New category</Button>}>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {match(categories)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-64 w-full" />)
        .otherwise(({ data }) => (
          <DataTable
            label="Categories"
            rows={data.items}
            rowKey={(category) => category.id}
            columns={[
              { key: "name", header: "Name", cell: (category) => <span className="font-medium text-ink">{category.name}</span> },
              { key: "slug", header: "Slug", cell: (category) => category.slug },
              { key: "products", header: "Products", isNumeric: true, cell: (category) => category.productCount },
              { key: "description", header: "Description", cell: (category) => <span className="line-clamp-2 min-w-48 text-ink-soft">{category.description ?? ""}</span> },
              {
                key: "actions",
                header: "Actions",
                cell: (category) => (
                  <span className="flex gap-1">
                    <Button tone="quiet" type="button" onClick={() => setEditing({ kind: "existing", category })} aria-label={`Edit ${category.name}`}>
                      Edit
                    </Button>
                    {category.productCount === 0 ? (
                      <Button tone="ghost" type="button" onClick={() => setDeleting(category)} aria-label={`Delete ${category.name}`}>
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        ))}

      <p className="text-sm text-ink-soft">A category that products are filed under cannot be deleted. Move its products to another category first.</p>

      <Dialog isOpen={editing.kind !== "none"} title={editing.kind === "existing" ? `Edit ${editing.category.name}` : "New category"} onClose={() => setEditing({ kind: "none" })}>
        {editing.kind === "none" ? null : (
          <CategoryForm
            key={editing.kind === "existing" ? editing.category.id : "new"}
            {...(editing.kind === "existing" ? { initial: editing.category } : {})}
            onCancel={() => setEditing({ kind: "none" })}
            onSave={async (input) => {
              if (editing.kind === "existing") {
                await update.mutateAsync({ id: editing.category.id, input });
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
        title={`Delete ${deleting?.name ?? "this category"}?`}
        confirmLabel="Delete category"
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
        Its page leaves the shop. No product is filed under it.
      </ConfirmDialog>
    </AdminPage>
  );
};
