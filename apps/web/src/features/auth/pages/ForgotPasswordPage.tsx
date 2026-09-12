import { ForgotPasswordInput } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";

/** Asks for an address to send a reset link to, and says the same thing either way. */
export const ForgotPasswordPage = () => {
  const [sent, setSent] = useState(false);
  const form = useForm({
    resolver: zodResolver(ForgotPasswordInput.schema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    // Always reports success: whether the address exists is not revealed.
    await Api.postEmpty("/auth/password/forgot", values).catch(() => undefined);
    setSent(true);
  });

  return (
    <AuthShell
      title="Reset your password"
      lede="We will email you a link if the address is registered."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      }
    >
      {match(sent)
        .with(true, () => (
          <Alert tone="accent" title="Check your inbox">
            If that address has an account, a reset link is on its way.
          </Alert>
        ))
        .with(false, () => (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            <Field
              label="Email address"
              type="email"
              autoComplete="email"
              error={form.formState.errors.email?.message}
              {...form.register("email")}
            />
            <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
              Send reset link
            </Button>
          </form>
        ))
        .exhaustive()}
    </AuthShell>
  );
};
