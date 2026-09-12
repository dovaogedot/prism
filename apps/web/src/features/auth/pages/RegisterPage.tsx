import { Password, RegisterForm, type AccessGrant } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useTheme } from "../../../shared/theme/use-theme.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { Captcha } from "../components/Captcha.tsx";
import { Failure } from "../components/failure.tsx";
import { ProviderButtons } from "../components/ProviderButtons.tsx";
import { TokenStore } from "../token-store.ts";

/** Opening an account, which signs in on success. */
export const RegisterPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(RegisterForm.schema),
    defaultValues: { email: "", password: "", confirmPassword: "", captchaToken: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    // `confirmPassword` is a browser-side guard against a typo; the server
    // has no use for it.
    await Api.postWithoutRetry<AccessGrant>("/auth/register", {
      email: values.email,
      password: values.password,
      captchaToken: values.captchaToken,
    })
      .then((grant) => {
        TokenStore.set(grant.accessToken, grant.user);
        void navigate("/");
      })
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  return (
    <AuthShell
      title="Create an account"
      lede="An email address, a password, and a check that you are a person."
      footer={
        <>
          Already have one?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <ProviderButtons />

      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {match(failure)
          .with(P.nullish, () => null)
          .otherwise((message) => <Alert>{message}</Alert>)}

        <Field
          label="Email address"
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register("email")}
        />

        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${Password.MIN_LENGTH} characters.`}
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />

        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={form.formState.errors.confirmPassword?.message}
          {...form.register("confirmPassword")}
        />

        <Captcha
          dark={theme === "dark"}
          onToken={(token) => form.setValue("captchaToken", token, { shouldValidate: true })}
        />

        {match(form.formState.errors.captchaToken?.message)
          .with(P.string.select(), (message) => (
            <p role="alert" className="text-sm text-danger">
              {message}
            </p>
          ))
          .otherwise(() => null)}

        <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
};
