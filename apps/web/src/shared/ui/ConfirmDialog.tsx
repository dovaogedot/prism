import type { ReactNode } from "react";
import { Button, type ButtonTone } from "./Button.tsx";
import { Dialog } from "./Dialog.tsx";

/** The question, its consequences, and what each answer does. */
export type ConfirmDialogProps = Readonly<{
  isOpen: boolean;
  title: string;
  children: ReactNode;
  /** What the confirming button says, such as "Delete product". */
  confirmLabel: string;
  tone?: ButtonTone;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>;

/** Asks before something that cannot be undone. Cancel is the default, and the first button focus reaches. */
export const ConfirmDialog = ({ isOpen, title, children, confirmLabel, tone = "danger", isBusy = false, onConfirm, onCancel }: ConfirmDialogProps) => (
  <Dialog isOpen={isOpen} title={title} onClose={onCancel}>
    <div className="text-sm text-ink-soft">{children}</div>
    <div className="flex flex-wrap justify-end gap-2">
      <Button tone="quiet" type="button" data-autofocus onClick={onCancel}>
        Cancel
      </Button>
      <Button tone={tone} type="button" busy={isBusy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  </Dialog>
);
