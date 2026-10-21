import { SavedAddress, type AddressId } from "@prism/shared";
import { useState } from "react";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, EmptyState, Skeleton, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { SignInFirst } from "../../auth/components/SignInFirst.tsx";
import { useSession } from "../../auth/session.ts";
import { useAccountChanges, useSavedAddresses } from "../account.ts";
import { AccountPage } from "../components/AccountPage.tsx";
import { AddressCard } from "../components/AddressCard.tsx";
import { AddressForm } from "../components/AddressForm.tsx";

/** Which form is open: none, a new address, or the address with that id. */
type Editing = Readonly<{ kind: "none" }> | Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; id: AddressId }>;

/**
 * The customer's saved addresses: up to ten, one of them the default that
 * checkout starts with. Each can be changed, made the default or deleted,
 * and deleting asks first. A guest is sent to sign in first.
 */
export const AddressesPage = () => {
  const session = useSession();

  const addresses = useSavedAddresses();

  const { addAddress, updateAddress, removeAddress } = useAccountChanges();

  const [editing, setEditing] = useState<Editing>({ kind: "none" });

  const [deleting, setDeleting] = useState<SavedAddress | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  if (session === undefined) return <SignInFirst />;

  const isFull = (addresses.data?.length ?? 0) >= SavedAddress.MAX;

  return (
    <AccountPage text={PageText.addresses} heading="Your addresses">

      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {match(addresses)
        .with({ status: "error" }, () => <Alert>Your addresses did not load. Try again in a moment.</Alert>)
        .with({ data: P.nonNullable.select() }, (found) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-soft">
                {found.length} of {SavedAddress.MAX} saved. Checkout starts with the default one.
              </p>
              {editing.kind === "new" || isFull ? null : <Button onClick={() => setEditing({ kind: "new" })}>Add an address</Button>}
            </div>

            {isFull ? <p className="text-sm text-ink-soft">You have saved the most addresses there can be. Delete one to add another.</p> : null}

            {editing.kind === "new" ? (
              <AddressForm
                onCancel={() => setEditing({ kind: "none" })}
                onSave={async (input) => {
                  await addAddress.mutateAsync(input);
                  setEditing({ kind: "none" });
                  Toast.show(`${input.label} is saved.`);
                }}
              />
            ) : null}

            {found.length === 0 && editing.kind !== "new" ? (
              <EmptyState title="No saved addresses yet">Add one here, or tick "Save this address" when you check out.</EmptyState>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {found.map((address) => {
                  const isEdited = editing.kind === "existing" && editing.id === address.id;

                  return (
                    <li className={isEdited ? "sm:col-span-2" : ""} key={address.id}>
                      {isEdited ? (
                        <AddressForm
                          address={address}
                          onCancel={() => setEditing({ kind: "none" })}
                          onSave={async (input) => {
                            await updateAddress.mutateAsync({ id: address.id, address: input });
                            setEditing({ kind: "none" });
                            Toast.show(`${input.label} is saved.`);
                          }}
                        />
                      ) : (
                        <AddressCard
                          address={address}
                          isBusy={updateAddress.isPending}
                          onEdit={() => setEditing({ kind: "existing", id: address.id })}
                          onDelete={() => setDeleting(address)}
                          onMakeDefault={() =>
                            updateAddress.mutate(
                              {
                                id: address.id,
                                address: { label: address.label, fullName: address.fullName, phone: address.phone, address: address.address, isDefault: true },
                              },
                              {
                                onSuccess: () => Toast.show(`Checkout now starts with ${address.label}.`),
                                onError: (reason) => setFailure(Failure.message(reason)),
                              },
                            )
                          }
                        />
                      )}
                    </li>
                    );
                })}
              </ul>
            )}
          </>
        ))
        .otherwise(() => (
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ))}

      <ConfirmDialog
        isOpen={deleting !== undefined}
        title={`Delete ${deleting?.label ?? "this address"}?`}
        confirmLabel="Delete address"
        isBusy={removeAddress.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting === undefined) return;

          removeAddress.mutate(deleting.id, {
            onSuccess: () => {
              Toast.show(`${deleting.label} is deleted.`);
              setDeleting(undefined);
            },
            onError: (reason) => {
              setFailure(Failure.message(reason));
              setDeleting(undefined);
            },
          });
        }}
      >
        Orders that went to this address keep it. Checkout will no longer offer it.
      </ConfirmDialog>
    </AccountPage>
  );
};
