import type { ShippingMethodInput, ShippingMethodView } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field, IssueList } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { ServerIssues, ShippingFields, ShippingForm } from "../forms.ts";

/** The option being changed, or none for a new one; where a new one goes in the list; what saving does; and how to leave. */
export type ShippingMethodFormProps = Readonly<{
  option?: ShippingMethodView;
  nextPosition: number;
  onSave: (input: ShippingMethodInput) => Promise<unknown>;
  onCancel: () => void;
}>;

/**
 * A delivery option: its code, which orders keep and which never changes,
 * its name, price and free-shipping threshold, its delivery window in
 * business days, its place in the list, and whether checkout offers it.
 */
export const ShippingMethodForm = ({ option, nextPosition, onSave, onCancel }: ShippingMethodFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const form = useForm({ resolver: zodResolver(ShippingFields.schema), defaultValues: ShippingForm.of(option, nextPosition) });

  const errors = form.formState.errors;
  const number = { valueAsNumber: true } as const;

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await onSave(ShippingForm.toInput(values)).catch((reason: unknown) => {
      const found = Api.failureOf(reason);
      if (found === undefined || found.issues.length === 0) {
        setFailure(Failure.message(reason));
        return;
      }
      const fields = ["code", "name", "price", "freeFrom", "minDays", "maxDays", "position"];
      const unplaced = ServerIssues.place(found.issues, fields, form.setError, { priceCents: "price", freeFromCents: "freeFrom" });
      if (unplaced.length > 0) {
        setFailure(<IssueList issues={unplaced} />);
      }
    });
  });

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          id="shipping-code"
          hint={option === undefined ? "Lowercase, such as express. It never changes." : "Orders keep it, so it cannot change."}
          readOnly={option !== undefined}
          error={errors.code?.message}
          {...form.register("code")}
        />
        <Field label="Name" id="shipping-name" error={errors.name?.message} {...form.register("name")} />
        <Field label="Price in euros" id="shipping-price" inputMode="decimal" error={errors.price?.message} {...form.register("price")} />
        <Field
          label="Free from, in euros (optional)"
          id="shipping-free-from"
          inputMode="decimal"
          hint="Orders of this much or more ship free."
          error={errors.freeFrom?.message}
          {...form.register("freeFrom")}
        />
        <Field label="Earliest business day" id="shipping-min-days" type="number" min={1} max={30} error={errors.minDays?.message} {...form.register("minDays", number)} />
        <Field label="Latest business day" id="shipping-max-days" type="number" min={1} max={30} error={errors.maxDays?.message} {...form.register("maxDays", number)} />
        <Field label="Place in the list" id="shipping-position" type="number" min={0} hint="Lower comes first." error={errors.position?.message} {...form.register("position", number)} />
      </div>
      <label className="flex items-center gap-2.5 text-sm text-ink">
        <input className="size-4 accent-[var(--color-accent)]" type="checkbox" {...form.register("isActive")} />
        Offer it at checkout
      </label>
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={form.formState.isSubmitting}>
          {option === undefined ? "Create option" : "Save option"}
        </Button>
      </div>
    </form>
  );
};
