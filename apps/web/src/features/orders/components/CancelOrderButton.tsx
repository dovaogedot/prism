import type { OrderDetail } from "@prism/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";

/** The order to cancel, and the guest key that opens it, if any. */
export type CancelOrderButtonProps = Readonly<{ order: OrderDetail; orderKey?: string }>;

/**
 * Cancels the order after asking. A paid order is refunded in full; the
 * dialog says so before anything happens.
 */
export const CancelOrderButton = ({ order, orderKey }: CancelOrderButtonProps) => {
  const dialog = useRef<HTMLDialogElement>(null);

  const client = useQueryClient();

  const cancel = useMutation({
    mutationFn: () =>
      Api.post<OrderDetail>(
        `/orders/${order.id}/cancel${orderKey === undefined ? "" : `?key=${encodeURIComponent(orderKey)}`}`,
      ),
    onSuccess: (detail) => {
      client.setQueryData(["order", order.id, orderKey], detail);
      void client.invalidateQueries({ queryKey: ["orders"] });
      dialog.current?.close();
    },
  });

  const paid = order.payment?.status === "succeeded";

  return (
    <>
      <Button type="button" tone="quiet" onClick={() => dialog.current?.showModal()}>
        Cancel order
      </Button>

      <dialog
        ref={dialog}
        aria-labelledby="cancel-title"
        className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-lg border border-line bg-surface p-0 text-ink backdrop:bg-black/40"
      >
        <div className="space-y-4 p-5">
          <h2 id="cancel-title" className="text-lg font-semibold">
            Cancel order #{order.number}?
          </h2>
          <p className="text-sm text-ink-soft">
            {paid
              ? "The items go back on sale and the full amount is refunded to your card. Banks usually show it within 5 to 10 business days."
              : "The items go back on sale and you will not be charged."}
          </p>

          {cancel.status === "error" ? <Alert>{Failure.message(cancel.error)}</Alert> : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" tone="ghost" onClick={() => dialog.current?.close()} disabled={cancel.isPending}>
              Keep the order
            </Button>
            <Button type="button" tone="danger" busy={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel order
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
};
