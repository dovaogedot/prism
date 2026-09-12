/**
 * The account page: the password, the second factor, and how sign-in happens.
 *
 * Enrollment is two steps: the secret is stored when setup begins, but 2FA is
 * not active until a live code proves the secret reached an authenticator
 * app. Otherwise a mistyped scan would lock the account out.
 */

import { PasswordForm, TwoFactorCodeInput, type SessionUser, type TwoFactorSetup } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Navigate } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Card, Field } from "../../../shared/ui/index.ts";
import { Failure } from "../components/failure.tsx";
import { useSession } from "../session.ts";
import { TokenStore } from "../token-store.ts";

const TwoFactorSetupFlow = ({ onDone }: Readonly<{ onDone: () => void }>) => {
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

const TwoFactorDisableFlow = ({ onDone }: Readonly<{ onDone: () => void }>) => {
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

/**
 * Changing the password, or setting the first one. The current-password
 * field appears only when there is a current password; an account created
 * through a provider has nothing to confirm.
 */
const PasswordFlow = ({ hasPassword, onDone }: Readonly<{ hasPassword: boolean; onDone: () => void }>) => {
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

/** The signed-in account's own page. */
export const AccountPage = () => {
  const session = useSession();
  const [notice, setNotice] = useState<ReactNode | undefined>(undefined);

  return match(session)
    .with(P.nullish, () => <Navigate to="/login" replace />)
    .otherwise((user) => (
      <div className="mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-6">
        <header className="space-y-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Your account</h1>
          <p className="text-sm text-ink-soft">{user.email}</p>
        </header>

        {match(notice)
          .with(P.nullish, () => null)
          .otherwise((message) => <Alert tone="accent">{message}</Alert>)}

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 className="font-semibold text-ink">Two-factor authentication</h2>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                user.twoFactorEnabled ? "bg-accent-wash text-ink" : "bg-sunken text-ink-faint"
              }`}
            >
              {user.twoFactorEnabled ? "On" : "Off"}
            </span>
          </div>

          {match(user.twoFactorEnabled)
            .with(false, () => (
              <TwoFactorSetupFlow onDone={() => setNotice("Two-factor authentication is now on.")} />
            ))
            .with(true, () => (
              <TwoFactorDisableFlow onDone={() => setNotice("Two-factor authentication is now off.")} />
            ))
            .exhaustive()}
        </Card>

        <Card className="p-5">
          <h2 className="mb-2 font-semibold text-ink">Sign-in methods</h2>
          <ul className="space-y-1 text-sm text-ink-soft">
            {match(user.hasPassword)
              .with(true, () => <li>Email and password.</li>)
              .with(false, () => null)
              .exhaustive()}

            {user.providers.map((provider) => (
              <li key={provider} className="capitalize">
                {provider}.
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold text-ink">Password</h2>

          <PasswordFlow
            hasPassword={user.hasPassword}
            onDone={() =>
              setNotice(
                user.hasPassword ? "Password changed." : "Password set. You can now sign in with your email.",
              )
            }
          />
        </Card>
      </div>
    ));
};
