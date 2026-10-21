/**
 * Turning on two-factor sign-in. Enrollment is two steps: the secret is
 * stored when setup begins, but 2FA is not active until a live code proves
 * the secret reached an authenticator app. Otherwise a mistyped scan would
 * lock the account out.
 */

import { TwoFactorCodeInput, type SessionUser, type TwoFactorSetup } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { TokenStore } from "../token-store.ts";
import { Failure } from "./failure.tsx";

/** What happens once two-factor sign-in is on. */
export type TwoFactorSetupFlowProps = Readonly<{ onDone: () => void }>;

export const TwoFactorSetupFlow = ({ onDone }: TwoFactorSetupFlowProps) => {
  const [setup, setSetup] = useState<TwoFactorSetup | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  const form = useForm({
    resolver: zodResolver(TwoFactorCodeInput.schema),
    defaultValues: { code: "" },
  });

  const begin = async (): Promise<void> => {
    setStarting(true);
    setFailure(undefined);

    await Api.post<TwoFactorSetup>("/auth/2fa/setup")
      .then((result) => setSetup(result))
      .catch((reason: unknown) => setFailure(Failure.message(reason)))
      .finally(() => setStarting(false));
  };

  const confirm = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.post<SessionUser>("/auth/2fa/enable", values)
      .then((user) => {
        TokenStore.updateUser(user);
        onDone();
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)));
  });

  return (
    <div className="space-y-4">
      {match(failure)
        .with(P.nullish, () => null)
        .otherwise((message) => <Alert>{message}</Alert>)}

      {match(setup)
        .with(P.nullish, () => (
          <>
            <p className="text-sm text-ink-soft">
              Adds a six-digit code from an authenticator app to every sign-in.
            </p>
            <Button busy={starting} onClick={() => void begin()}>
              Set up two-factor authentication
            </Button>
          </>
        ))
        .otherwise((value) => (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Scan this with your authenticator app, then type the code it shows to confirm it worked.
            </p>

            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <div
                className="qr w-40 shrink-0 rounded-lg border border-line bg-white p-3"
                // Server-generated SVG with no user input in it.
                dangerouslySetInnerHTML={{ __html: value.qrCodeSvg }}
              />

              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">
                  Or enter this manually
                </p>
                <code className="block break-all rounded-lg bg-sunken px-3 py-2 font-mono text-xs text-ink-soft">
                  {value.uri}
                </code>
              </div>
            </div>

            <form onSubmit={(event) => void confirm(event)} className="space-y-3" noValidate>
              <Field
                label="Code from the app"
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                className="max-w-40 text-center font-mono text-lg tracking-[0.3em]"
                error={form.formState.errors.code?.message}
                {...form.register("code")}
              />
              <Button type="submit" busy={form.formState.isSubmitting}>
                Turn it on
              </Button>
            </form>
          </div>
        ))}
    </div>
  );
};
