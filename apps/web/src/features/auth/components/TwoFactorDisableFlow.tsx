/**
 * Turning off two-factor sign-in, which takes a current code. Staff accounts
 * need two-factor sign-in, so staff lose their roles with it, and are asked
 * to confirm that first.
 */

import { StaffRole, TwoFactorCodeInput, type SessionUser } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, ConfirmDialog, Field } from "../../../shared/ui/index.ts";
import { TokenStore } from "../token-store.ts";
import { Failure } from "./failure.tsx";

/** The account's staff roles, and what happens once two-factor sign-in is off. */
export type TwoFactorDisableFlowProps = Readonly<{
  /** The staff roles the account loses with its second factor; empty for a customer. */
  roles: readonly StaffRole[];
  /** Called with the line that tells the reader what changed. */
  onDone: (notice: string) => void;
}>;

/** At least one staff role. */
type HeldRoles = readonly [StaffRole, ...StaffRole[]];

/** The roles as their owner loses them: "your Admin status", "your Moderator and Support statuses". */
const statusesOf = (roles: HeldRoles): string => {
  const labels: readonly string[] = roles.map((role) => StaffRole.label[role]);
  const names = labels.reduce((text, label, index) => `${text}${index === labels.length - 1 ? " and " : ", "}${label}`);

  return `your ${names} ${labels.length === 1 ? "status" : "statuses"}`;
};

export const TwoFactorDisableFlow = ({ roles, onDone }: TwoFactorDisableFlowProps) => {
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [isConfirming, setConfirming] = useState(false);
  const [first, ...rest] = roles;
  const held: HeldRoles | undefined = first === undefined ? undefined : [first, ...rest];

  const form = useForm({
    resolver: zodResolver(TwoFactorCodeInput.schema),
    defaultValues: { code: "" },
  });

  const turnOff = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.post<SessionUser>("/auth/2fa/disable", values)
      .then((user) => {
        TokenStore.updateUser(user);
        onDone(
          held === undefined
            ? "Two-factor authentication is now off."
            : `Two-factor authentication is now off, and ${statusesOf(held)} ${held.length === 1 ? "is" : "are"} revoked.`,
        );
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)))
      .finally(() => setConfirming(false));
  });

  // Staff see what they lose before anything is sent; a customer's code goes straight away.
  const submit = held === undefined ? turnOff : form.handleSubmit(() => setConfirming(true));

  return (
    <>
      <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
        {match(failure)
          .with(P.nullish, () => null)
          .otherwise((message) => <Alert>{message}</Alert>)}

        <p className="text-sm text-ink-soft">
          Turning this off needs a current code, so a stolen session cannot remove your second factor.
        </p>

        <Field
          label="Code from the app"
          inputMode="numeric"
          maxLength={6}
          autoComplete="one-time-code"
          className="max-w-40 text-center font-mono text-lg tracking-[0.3em]"
          error={form.formState.errors.code?.message}
          {...form.register("code")}
        />

        <Button type="submit" tone="danger" busy={form.formState.isSubmitting}>
          Turn off two-factor
        </Button>
      </form>

      {held === undefined ? null : (
        <ConfirmDialog
          isOpen={isConfirming}
          title="Turn off two-factor?"
          confirmLabel="Turn off two-factor"
          isBusy={form.formState.isSubmitting}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void turnOff()}
        >
          <p>
            Staff accounts need two-factor authentication, so {statusesOf(held)} will be revoked. To get staff access
            back, turn two-factor on again and ask an admin.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
};
