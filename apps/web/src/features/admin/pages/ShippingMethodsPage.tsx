import { Price, ShippingOption, type ShippingMethodInput, type ShippingMethodView } from "@prism/shared";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, DataTable, Dialog, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";
import { ShippingMethodForm } from "../components/ShippingMethodForm.tsx";

/** Which form is open: none, a new option, or the option given. */
type Editing = Readonly<{ kind: "none" }> | Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; option: ShippingMethodView }>;

/**
 * The delivery options checkout offers, in their order. An option no order
 * used can be deleted; one that orders used is switched off instead, so the
 * orders keep what they were charged.
 */
export const ShippingMethodsPage = () => {
  const options = useAdminRead<{ items: readonly ShippingMethodView[] }>(AdminKeys.list("shipping", ""), "/shipping-methods");

  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const [deleting, setDeleting] = useState<ShippingMethodView | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const create = useAdminWrite((input: ShippingMethodInput) => Api.post<ShippingMethodView>("/admin/shipping-methods", input));

  const update = useAdminWrite((input: ShippingMethodInput) => Api.put<ShippingMethodView>(`/admin/shipping-methods/${input.code}`, input));

  const remove = useAdminWrite((code: string) => Api.requestEmpty(`/admin/shipping-methods/${code}`, { method: "DELETE" }));

  const nextPosition = Math.max(0, ...(options.data?.items ?? []).map((option) => option.position + 10));

  return (
    <AdminPage text={PageText.adminShipping} heading="Delivery options" actions={<Button onClick={() => setEditing({ kind: "new" })}>New option</Button>}>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {match(options)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-64 w-full" />)
        .otherwise(({ data }) => (
          <DataTable
            label="Delivery options"
            rows={data.items}
            rowKey={(option) => option.code}
            columns={[
              {
                key: "name",
                header: "Option",
                cell: (option) => (
                  <span className="block min-w-32">
                    <span className="block font-medium text-ink">{option.name}</span>
                    <span className="block text-xs text-ink-soft">{option.code}</span>
                  </span>
                ),
              },
              { key: "price", header: "Price", isNumeric: true, cell: (option) => Price.format(option.priceCents) },
              { key: "free", header: "Free from", isNumeric: true, cell: (option) => (option.freeFromCents === undefined ? "Never" : Price.format(option.freeFromCents)) },
              { key: "window", header: "Arrives in", cell: (option) => <span className="whitespace-nowrap">{ShippingOption.windowOf(option)}</span> },
              { key: "active", header: "Offered", cell: (option) => (option.isActive ? "Yes" : "No") },
              { key: "orders", header: "Orders", isNumeric: true, cell: (option) => option.orderCount },
              {
                key: "actions",
                header: "Actions",
                cell: (option) => (
                  <span className="flex gap-1">
                    <Button tone="quiet" type="button" onClick={() => setEditing({ kind: "existing", option })} aria-label={`Edit ${option.name}`}>
                      Edit
                    </Button>
                    {option.orderCount === 0 ? (
                      <Button tone="ghost" type="button" onClick={() => setDeleting(option)} aria-label={`Delete ${option.name}`}>
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        ))}

      <Dialog isOpen={editing.kind !== "none"} title={editing.kind === "existing" ? `Edit ${editing.option.name}` : "New delivery option"} onClose={() => setEditing({ kind: "none" })}>
        {editing.kind === "none" ? null : (
          <ShippingMethodForm
            key={editing.kind === "existing" ? editing.option.code : "new"}
            {...(editing.kind === "existing" ? { option: editing.option } : {})}
            nextPosition={nextPosition}
            onCancel={() => setEditing({ kind: "none" })}
            onSave={async (input) => {
              if (editing.kind === "existing") {
                await update.mutateAsync(input);
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
        title={`Delete ${deleting?.name ?? "this option"}?`}
        confirmLabel="Delete option"
        isBusy={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting === undefined) return;
          remove.mutate(deleting.code, {
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
        Checkout stops offering it. No order used it, so no order changes.
      </ConfirmDialog>
    </AdminPage>
  );
};
