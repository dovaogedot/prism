import { Country, type SavedAddress } from "@prism/shared";
import { Button } from "../../../shared/ui/index.ts";

/** The address, and what its buttons do. */
export type AddressCardProps = Readonly<{
  address: SavedAddress;
  onEdit: () => void;
  onMakeDefault: () => void;
  onDelete: () => void;
  isBusy: boolean;
}>;

/** One saved address as the list shows it, with its name, who receives it, where, and its actions. */
export const AddressCard = ({ address, onEdit, onMakeDefault, onDelete, isBusy }: AddressCardProps) => (
  <article className="flex h-full flex-col gap-3 rounded-lg border border-line bg-surface p-5 text-sm">
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-semibold text-ink">{address.label}</h2>
      {address.isDefault ? <span className="rounded-full bg-accent-wash px-2.5 py-0.5 text-xs font-medium text-ink">Default</span> : null}
    </div>
    <div className="flex-1 space-y-0.5 text-ink-soft">
      <p className="text-ink">{address.fullName}</p>
      <p>{address.address.line1}</p>
      {address.address.line2 === undefined ? null : <p>{address.address.line2}</p>}
      <p>
        {address.address.postalCode} {address.address.city}
      </p>
      <p>{Country.name[address.address.country]}</p>
      <p className="pt-1">{address.phone}</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button tone="quiet" type="button" onClick={onEdit} aria-label={`Edit ${address.label}`}>
        Edit
      </Button>
      {address.isDefault ? null : (
        <Button tone="quiet" type="button" disabled={isBusy} onClick={onMakeDefault} aria-label={`Make ${address.label} the default`}>
          Make default
        </Button>
      )}
      <Button tone="ghost" type="button" onClick={onDelete} aria-label={`Delete ${address.label}`}>
        Delete
      </Button>
    </div>
  </article>
);
