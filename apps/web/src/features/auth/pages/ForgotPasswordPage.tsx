import { ForgotPasswordInput } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/index.ts";
import { Failure } from "../components/failure.tsx";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";

/** Asks for an address to send a reset link to, and says the same thing whether or not it has an account. */
export const ForgotPasswordPage = () => {
  const [isSent, setSent] = useState(false);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(ForgotPasswordInput.schema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    // The server answers alike for every address, so only a request that failed, such as a rate limit or no connection, shows here.
    await Api.postEmpty("/auth/password/forgot", values)
      .then(() => setSent(true))
      .catch((reason: unknown) => setFailure(Failure.message(reason)));
  });

  return (
    <AuthShell
      title="Reset your password"
      lede="We will email you a link if the address is registered."
      footer={
        <Link to="/login" className="font-medium text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      }
    >
      <PageMeta title={PageText.forgotPassword.title} description={PageText.forgotPassword.description} isIndexed={false} />
      {match(isSent)
        .with(true, () => (
          <Alert tone="accent" title="Check your inbox">
            If that address has an account, a reset link is on its way.
          </Alert>
        ))
        .with(false, () => (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            {failure === undefined ? null : <Alert>{failure}</Alert>}
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
