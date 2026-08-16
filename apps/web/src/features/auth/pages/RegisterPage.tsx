import { registerSchema, Option, type AccessGrant, type RegisterInput } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { match } from "ts-pattern";
import { api } from "../../../shared/api/client.ts";
import { useTheme } from "../../../shared/theme/use-theme.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { Captcha } from "../components/Captcha.tsx";
import { describeFailure } from "../components/error-message.tsx";
import { ProviderButtons } from "../components/ProviderButtons.tsx";
import { tokenStore } from "../token-store.ts";

export const RegisterPage = () => {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const [captchaToken, setCaptchaToken] = useState("");
  const [failure, setFailure] = useState<Option<ReactNode>>(Option.none);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", captchaToken: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .postWithoutRetry<AccessGrant>("/auth/register", { ...values, captchaToken })
      .then((grant) => {
        tokenStore.set(grant.accessToken, grant.user);
        void navigate("/");
      })
      .catch((reason: unknown) => setFailure(Option.some(describeFailure(reason))));
  });

  return (
    <AuthShell
      title="Create an account"
      lede="One address, one password, and a promise you are a person."
      footer={
        <>
          Already have one? <Link to="/login" className="font-medium text-accent hover:underline">Sign in</Link>
        </>
      }
    >
      <ProviderButtons />

      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {match(failure)
          .with({ _tag: "Some" }, ({ value }) => <Alert>{value}</Alert>)
          .with({ _tag: "None" }, () => null)
          .exhaustive()}

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
          hint="At least 12 characters. Length beats punctuation."
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />

        <Captcha
          dark={theme === "dark"}
          onToken={(token) => {
            setCaptchaToken(token);
            form.setValue("captchaToken", token, { shouldValidate: true });
          }}
        />

        <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
};

/* ------------------------------------------------------------------ login */
