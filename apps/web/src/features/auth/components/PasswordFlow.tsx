import { PasswordForm, type SessionUser } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { TokenStore } from "../token-store.ts";
import { Failure } from "./failure.tsx";

/** Whether the account has a password to confirm, and what happens once the new one is saved. */
export type PasswordFlowProps = Readonly<{ hasPassword: boolean; onDone: () => void }>;

/**
 * Changing the password, or setting the first one. The current-password
 * field appears only when there is a current password; an account created
 * through a provider has nothing to confirm.
 */
export const PasswordFlow = ({ hasPassword, onDone }: PasswordFlowProps) => {
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(hasPassword ? PasswordForm.change : PasswordForm.set),
    defaultValues: { currentPassword: "", password: "", confirmPassword: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    // The confirmation never leaves the browser, and neither does an empty
    // current password on an account that has none.
    const body = hasPassword
      ? { currentPassword: values.currentPassword, password: values.password }
      : { password: values.password };

    await Api.post<SessionUser>("/auth/password", body)
      .then((user) => {
        TokenStore.updateUser(user);
        form.reset();
        onDone();
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)));
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
      {match(failure)
        .with(P.nullish, () => null)
        .otherwise((message) => <Alert>{message}</Alert>)}

      {match(hasPassword)
        .with(false, () => (
          <p className="text-sm text-ink-soft">
            You signed up through a provider, so this account has no password. Add one and you can
            sign in with your email as well.
          </p>
        ))
        .with(true, () => (
          <Field
            label="Current password"
            type="password"
            autoComplete="current-password"
            error={form.formState.errors.currentPassword?.message}
            {...form.register("currentPassword")}
          />
        ))
        .exhaustive()}

      <Field
        label="New password"
        type="password"
        autoComplete="new-password"
        error={form.formState.errors.password?.message}
        {...form.register("password")}
      />

      <Field
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        error={form.formState.errors.confirmPassword?.message}
        {...form.register("confirmPassword")}
      />

      <Button type="submit" busy={form.formState.isSubmitting}>
        {hasPassword ? "Change password" : "Set a password"}
      </Button>
    </form>
  );
};
