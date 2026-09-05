import { resetPasswordFormSchema, Option } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router";
import { match } from "ts-pattern";
import { api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { describeFailure } from "../components/error-message.tsx";
import { tokenStore } from "../token-store.ts";

/** Choosing a new password against a token from an email. */
export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failure, setFailure] = useState<Option<ReactNode>>(Option.none);
  const [done, setDone] = useState(false);

  const form = useForm({
    resolver: zodResolver(resetPasswordFormSchema),
    defaultValues: {
      token: params.get("token") ?? "",
      password: "",
      confirmPassword: "",
    },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      // The confirmation is a browser-side typo guard; the server has no use
      // for it.
      .postEmptyWithoutRetry("/auth/password/reset", {
        token: values.token,
        password: values.password,
      })
      .then(() => {
        // Every session was revoked server-side, so the visitor signs in fresh.
        tokenStore.clear();
        setDone(true);
        setTimeout(() => void navigate("/login"), 2200);
      })
      .catch((reason: unknown) => setFailure(Option.some(describeFailure(reason))));
  });

  return (
    <AuthShell
      title="Choose a new password"
      lede="This also signs you out everywhere else."
    >
      {match(done)
        .with(true, () => (
          <Alert tone="accent" title="Password changed">
            Taking you to the sign-in page…
          </Alert>
        ))
        .with(false, () => (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            {match(failure)
              .with({ _tag: "Some" }, ({ value }) => <Alert>{value}</Alert>)
              .with({ _tag: "None" }, () => null)
              .exhaustive()}

            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              hint="At least 12 characters."
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

            <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
              Change password
            </Button>
          </form>
        ))
        .exhaustive()}
    </AuthShell>
  );
};

/* ------------------------------------------------------------ oauth return */
