/**
 * The account page, which in project 1 exists mainly to switch 2FA on and off.
 *
 * Enrolment is two steps on purpose: the secret is stored when setup begins,
 * but 2FA is not active until a live code proves the secret actually reached
 * an authenticator app. Otherwise a mistyped scan would lock the account out.
 */

import {
  enableTwoFactorSchema,
  messageOf,
  Option,
  type SessionUser,
  type TwoFactorSetup,
} from "@hue/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Navigate } from "react-router";
import { match } from "ts-pattern";
import { api, toApiFailure } from "../lib/api.ts";
import { useSession } from "../lib/session.ts";
import { tokenStore } from "../lib/token-store.ts";
import { Alert, Button, Card, Field } from "../components/primitives.tsx";

const describe = (reason: unknown): string =>
  match(toApiFailure(reason))
    .with({ _tag: "Some" }, ({ value }) => messageOf(value.error))
    .with({ _tag: "None" }, () => "We could not reach the server.")
    .exhaustive();

const TwoFactorSetupFlow = ({ onDone }: Readonly<{ onDone: () => void }>) => {
  const [setup, setSetup] = useState<Option<TwoFactorSetup>>(Option.none);
  const [failure, setFailure] = useState<Option<string>>(Option.none);
  const [starting, setStarting] = useState(false);

  const form = useForm({
    resolver: zodResolver(enableTwoFactorSchema),
    defaultValues: { code: "" },
  });

  const begin = async (): Promise<void> => {
    setStarting(true);
    setFailure(Option.none);

    await api
      .post<TwoFactorSetup>("/auth/2fa/setup")
      .then((result) => setSetup(Option.some(result)))
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))))
      .finally(() => setStarting(false));
  };

  const confirm = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .post<SessionUser>("/auth/2fa/enable", values)
      .then((user) => {
        tokenStore.updateUser(user);
        onDone();
      })
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
  });

  return (
    <div className="space-y-4">
      {match(failure)
        .with({ _tag: "Some" }, ({ value }) => <Alert>{value}</Alert>)
        .with({ _tag: "None" }, () => null)
        .exhaustive()}

      {match(setup)
        .with({ _tag: "None" }, () => (
          <>
            <p className="text-sm text-ink-soft">
              Adds a six-digit code from your phone to every sign-in. Works with
              Google Authenticator, Authy, 1Password, or anything else that
              speaks TOTP.
            </p>
            <Button busy={starting} onClick={() => void begin()}>
              Set up two-factor authentication
            </Button>
          </>
        ))
        .with({ _tag: "Some" }, ({ value }) => (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Scan this with your authenticator app, then type the code it shows
              to confirm it worked.
            </p>

            <div className="flex flex-col items-start gap-4 sm:flex-row">
              <div
                className="qr w-40 shrink-0 rounded-lg border border-line bg-surface p-3"
                // The QR is server-generated SVG with a transparent background,
                // so it inherits the page theme. It contains no user input.
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
        ))
        .exhaustive()}
    </div>
  );
};

const TwoFactorDisableFlow = ({ onDone }: Readonly<{ onDone: () => void }>) => {
  const [failure, setFailure] = useState<Option<string>>(Option.none);

  const form = useForm({
    resolver: zodResolver(enableTwoFactorSchema),
    defaultValues: { code: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .post<SessionUser>("/auth/2fa/disable", values)
      .then((user) => {
        tokenStore.updateUser(user);
        onDone();
      })
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
  });

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-3" noValidate>
      {match(failure)
        .with({ _tag: "Some" }, ({ value }) => <Alert>{value}</Alert>)
        .with({ _tag: "None" }, () => null)
        .exhaustive()}

      <p className="text-sm text-ink-soft">
        Turning this off needs a current code — a stolen session should not be
        able to remove your second factor.
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

export const AccountPage = () => {
  const session = useSession();
  const [notice, setNotice] = useState<Option<ReactNode>>(Option.none);

  return match(session)
    .with({ _tag: "None" }, () => <Navigate to="/login" replace />)
    .with({ _tag: "Some" }, ({ value }) => (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            Your account
          </h1>
          <p className="text-sm text-ink-soft">{value.email}</p>
        </header>

        {match(notice)
          .with({ _tag: "Some" }, ({ value: message }) => (
            <Alert tone="accent">{message}</Alert>
          ))
          .with({ _tag: "None" }, () => null)
          .exhaustive()}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-semibold text-ink">Two-factor authentication</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                value.twoFactorEnabled
                  ? "bg-accent-wash text-ink"
                  : "bg-sunken text-ink-faint"
              }`}
            >
              {value.twoFactorEnabled ? "On" : "Off"}
            </span>
          </div>

          {match(value.twoFactorEnabled)
            .with(false, () => (
              <TwoFactorSetupFlow
                onDone={() =>
                  setNotice(
                    Option.some("Two-factor authentication is now on."),
                  )
                }
              />
            ))
            .with(true, () => (
              <TwoFactorDisableFlow
                onDone={() =>
                  setNotice(Option.some("Two-factor authentication is now off."))
                }
              />
            ))
            .exhaustive()}
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 font-semibold text-ink">Sign-in method</h2>
          <p className="text-sm text-ink-soft">
            {match(value.hasPassword)
              .with(true, () => "Email and password.")
              .with(false, () => "Google. This account has no password set.")
              .exhaustive()}
          </p>
        </Card>
      </div>
    ))
    .exhaustive();
};
