import { TwoFactorCodeInput, type SessionUser } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { TokenStore } from "../../auth/token-store.ts";

/** What happens once the code is accepted. */
export type StepUpFormProps = Readonly<{ onDone: () => void }>;

/** Asks a signed-in staff member for a current code from their authenticator app, which opens the admin for some hours. */
export const StepUpForm = ({ onDone }: StepUpFormProps) => {
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(TwoFactorCodeInput.schema),
    defaultValues: { code: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.post<SessionUser>("/auth/2fa/verify", values)
      .then((user) => {
        TokenStore.updateUser(user);
        onDone();
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)));
  });

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}
      <Field
        label="Six-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        autoFocus
        className="max-w-40 text-center font-mono text-lg tracking-[0.3em]"
        error={form.formState.errors.code?.message}
        {...form.register("code")}
      />
      <Button type="submit" busy={form.formState.isSubmitting}>
        Confirm
      </Button>
    </form>
  );
};
