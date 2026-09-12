import { TwoFactorLoginInput, type AccessGrant } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { Failure } from "../components/failure.tsx";
import { TokenStore } from "../token-store.ts";

/**
 * The challenge token the sign-in page handed over in navigation state,
 * rather than the URL, where it would end up in history and referrers.
 * Empty when this page was opened cold, or after a provider sign-in, which
 * leaves the challenge in an httpOnly cookie instead.
 */
const ChallengeState = {
  read: (): string =>
    typeof history.state === "object" &&
    history.state !== null &&
    "usr" in history.state &&
    typeof history.state.usr === "object" &&
    history.state.usr !== null &&
    "challengeToken" in history.state.usr &&
    typeof history.state.usr.challengeToken === "string"
      ? history.state.usr.challengeToken
      : "",
} as const;

/** The second step of sign-in, reached only with a live challenge. */
export const TwoFactorPage = () => {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);
  // Read once, at mount: history has moved on by the time a navigation away
  // is in flight, and the token for this attempt cannot change.
  const [challengeToken] = useState(ChallengeState.read);

  const form = useForm({
    resolver: zodResolver(TwoFactorLoginInput.schema),
    defaultValues: { challengeToken, code: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    // With no token in hand, the code goes alone and the server finds the
    // challenge in its cookie.
    const body =
      values.challengeToken === undefined || values.challengeToken === ""
        ? { code: values.code }
        : { challengeToken: values.challengeToken, code: values.code };

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
