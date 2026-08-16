import { twoFactorLoginSchema, Option, type AccessGrant } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { match } from "ts-pattern";
import { api } from "../../../shared/api/client.ts";
import { Alert, Button, Field } from "../../../shared/ui/index.ts";
import { AuthShell } from "../components/AuthShell.tsx";
import { describeFailure } from "../components/error-message.tsx";
import { tokenStore } from "../token-store.ts";

/** The token React Router was handed, or "" when this page was opened cold. */
const readChallengeToken = (): string =>
  typeof history.state === "object" &&
  history.state !== null &&
  "usr" in history.state &&
  typeof history.state.usr === "object" &&
  history.state.usr !== null &&
  "challengeToken" in history.state.usr &&
  typeof history.state.usr.challengeToken === "string"
    ? history.state.usr.challengeToken
    : "";

export const TwoFactorPage = () => {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Option<ReactNode>>(Option.none);

  /**
   * Carried in navigation state rather than the URL: a challenge token in the
   * address bar ends up in history and in any referrer header.
   *
   * Read once, at mount. Reading it every render means reading it again while
   * a navigation is in flight — history has moved on by then, the token comes
   * back empty, and the page renders "this needs a sign-in first" at the exact
   * moment the sign-in succeeded. The token for this attempt cannot change
   * under the component anyway.
   */
  const [challengeToken] = useState(readChallengeToken);
    history.state !== null &&
    "usr" in history.state &&
    typeof history.state.usr === "object" &&
    history.state.usr !== null &&
    "challengeToken" in history.state.usr &&
    typeof history.state.usr.challengeToken === "string"
      ? history.state.usr.challengeToken
      : "";

  const form = useForm({
    resolver: zodResolver(twoFactorLoginSchema),
    defaultValues: { challengeToken, code: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .postWithoutRetry<{ status: "authenticated"; grant: AccessGrant }>(
        "/auth/login/2fa",
        values,
      )
      .then((outcome) => {
        tokenStore.set(outcome.grant.accessToken, outcome.grant.user);
        void navigate("/");
      })
      .catch((reason: unknown) => setFailure(Option.some(describeFailure(reason))));
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
        {match(challengeToken)
          .with("", () => (
            <Alert title="This page needs a sign-in first">
              Go back and enter your email and password.
            </Alert>
          ))
          .otherwise(() => null)}

        {match(failure)
          .with({ _tag: "Some" }, ({ value }) => <Alert>{value}</Alert>)
          .with({ _tag: "None" }, () => null)
          .exhaustive()}

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

        <Button
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={challengeToken === ""}
          className="w-full"
        >
          Verify
        </Button>
      </form>
    </AuthShell>
  );
};
