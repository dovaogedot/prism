/** Turning off two-factor sign-in, which takes a current code. */

import { TwoFactorCodeInput, type SessionUser } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { TokenStore } from "../token-store.ts";
import { Failure } from "./failure.tsx";

/** What happens once two-factor sign-in is off. */
export type TwoFactorDisableFlowProps = Readonly<{ onDone: () => void }>;

export const TwoFactorDisableFlow = ({ onDone }: TwoFactorDisableFlowProps) => {
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(TwoFactorCodeInput.schema),
    defaultValues: { code: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.post<SessionUser>("/auth/2fa/disable", values)
      .then((user) => {
        TokenStore.updateUser(user);
        onDone();
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)));
  });

  return (
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
  );
};
