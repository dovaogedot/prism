import { LoginInput, type LoginOutcome } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { Failure } from "../components/failure.tsx";
import { ProviderButtons } from "../components/ProviderButtons.tsx";
import { TokenStore } from "../token-store.ts";

/** Sign-in, which lands either on the catalog or on the second-factor page. */
export const LoginPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // The OAuth callback redirects here with a reason when it fails.
  const [failure, setFailure] = useState<ReactNode | undefined>(() => {
    const code = params.get("error");
    return code === null ? undefined : `Sign-in failed (${code}). Please try again.`;
  });

  const form = useForm({
    resolver: zodResolver(LoginInput.schema),
    defaultValues: { email: "", password: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await Api.postWithoutRetry<LoginOutcome>("/auth/login", values)
      .then((outcome) =>
        match(outcome)
          .with({ status: "authenticated" }, ({ grant }) => {
            TokenStore.set(grant.accessToken, grant.user);
            void navigate("/");
          })
          .with({ status: "two_factor_required" }, ({ challengeToken }) => {
            // The challenge is short-lived and single-purpose; the history
            // entry is replaced so Back does not return to a spent form.
            void navigate("/login/2fa", { state: { challengeToken }, replace: true });
          })
          .exhaustive(),
      )
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  return (
    <AuthShell
      title="Sign in"
      lede="Welcome back."
      footer={
        <>
          No account yet?{" "}
          <Link to="/register" className="font-medium text-accent hover:underline">
            Create one
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
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
};
