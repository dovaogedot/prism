import { TwoFactorLoginInput, type AccessGrant } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { ChallengeState } from "../challenge-state.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { Failure } from "../components/failure.tsx";
import { TokenStore } from "../token-store.ts";

/**
 * What the person types. The challenge token is no field of the form, so
 * nothing can fail validation behind a field the page does not show.
 */
const CodeForm = {
  schema: TwoFactorLoginInput.schema.pick({ code: true }),
} as const;

/**
 * The second step of a challenged sign-in. Opened without a challenge, it
 * still takes a code, and the server refuses it.
 */
export const TwoFactorPage = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);
  // Read once, at mount: the token for this attempt cannot change.
  const [challengeToken] = useState(() => ChallengeState.read(state));

  const form = useForm({
    resolver: zodResolver(CodeForm.schema),
    defaultValues: { code: "" },
  });

  const submit = form.handleSubmit(async ({ code }) => {
    setFailure(undefined);

    // Without a token the code goes alone, and the server reads the
    // challenge from its cookie.
    const body: TwoFactorLoginInput = challengeToken === undefined ? { code } : { challengeToken, code };

    await Api.postWithoutRetry<{ status: "authenticated"; grant: AccessGrant }>("/auth/login/2fa", body)
      .then((outcome) => {
        TokenStore.set(outcome.grant.accessToken, outcome.grant.user);
        void navigate("/");
      })
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  return (
    <AuthShell
      title="Two-factor code"
      lede="Open your authenticator app and enter the current six digits."
      footer={
        <Link to="/login" className="font-medium text-accent hover:underline">
          Start over
        </Link>
      }
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
        {match(failure)
          .with(P.nullish, () => null)
          .otherwise((message) => <Alert>{message}</Alert>)}

        <Field
          label="Six-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          className="text-center font-mono text-lg tracking-[0.4em]"
          error={form.formState.errors.code?.message}
          {...form.register("code")}
        />

        <Button type="submit" busy={form.formState.isSubmitting} className="w-full">
          Verify
        </Button>
      </form>
    </AuthShell>
  );
};
