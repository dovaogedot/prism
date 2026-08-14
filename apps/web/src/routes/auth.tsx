/**
 * Registration, sign-in, the second factor, and password recovery.
 *
 * Every form validates with the same Zod schema the server enforces —
 * `@hue/shared` exports one definition and both sides import it, so the two
 * cannot drift.
 */

import {
  loginSchema,
  OAUTH_PROVIDER_LABELS,
  messageOf,
  Option,
  registerSchema,
  resetPasswordSchema,
  twoFactorLoginSchema,
  type AccessGrant,
  type AvailableProviders,
  type LoginOutcome,
  type OAuthProviderName,
  type RegisterInput,
  type ResetPasswordInput,
} from "@hue/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { z } from "zod";
import { api, toApiFailure } from "../lib/api.ts";
import { tokenStore } from "../lib/token-store.ts";
import { useTheme } from "../lib/theme.ts";
import { Captcha } from "../components/Captcha.tsx";
import { Alert, Button, Field, IssueList } from "../components/primitives.tsx";

/** Turns a rejected request into something a person can read. */
const describe = (reason: unknown): ReactNode =>
  match(toApiFailure(reason))
    .with({ _tag: "Some" }, ({ value }) =>
      match(value.error)
        .with({ _tag: "ValidationFailed" }, (error) => (
          <IssueList issues={error.issues} />
        ))
        .otherwise((error) => messageOf(error)),
    )
    .with({ _tag: "None" }, () => "We could not reach the server. Try again.")
    .exhaustive();

const AuthShell = ({
  title,
  lede,
  children,
  footer,
}: Readonly<{
  title: string;
  lede: string;
  children: ReactNode;
  footer?: ReactNode;
}>) => (
  <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-md flex-col justify-center px-4 py-12">
    <div className="mb-6 space-y-1.5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="text-sm text-ink-soft">{lede}</p>
    </div>

    <div className="rounded-[--radius-card] border border-line bg-surface p-6">
      {children}
    </div>

    {match(footer)
      .with(P.nullish, () => null)
      .otherwise((content) => (
        <div className="mt-4 text-center text-sm text-ink-soft">{content}</div>
      ))}
  </div>
);

const PROVIDER_MARK: Record<OAuthProviderName, ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7C21.7 18.9 23 15.9 23 12.3z" />
      <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3C3.7 21.4 7.6 24 12 24z" />
      <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.6 1.8 6.1l3.8 3c.9-2.7 3.4-4.3 6.4-4.3z" />
    </svg>
  ),
  // GitHub's mark is monochrome by design, so it takes the page's ink and
  // stays legible in both themes.
  github: (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.93-.89-1.18-.89-1.18-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.23 1.88.87 2.34.67.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.03 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.14.46.55.38A8 8 0 0 0 8 0z" />
    </svg>
  ),
};

/**
 * The buttons come from `GET /auth/oauth/providers` rather than being
 * hardcoded, so an instance configured with only GitHub credentials does not
 * offer a Google button that cannot work.
 */
const ProviderButtons = () => {
  const available = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: ({ signal }) =>
      api.get<AvailableProviders>("/auth/oauth/providers", signal),
    staleTime: Number.POSITIVE_INFINITY,
  });

  return match(available.data)
    .with(P.nullish, () => null)
    .when(
      (data) => data.providers.length === 0,
      () => null,
    )
    .otherwise((data) => (
      <>
        <div className="space-y-2">
          {data.providers.map((provider) => (
            <a
              key={provider}
              href={`/api/v1/auth/oauth/${provider}`}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-line-strong hover:bg-sunken"
            >
              {PROVIDER_MARK[provider]}
              Continue with {OAUTH_PROVIDER_LABELS[provider]}
            </a>
          ))}
        </div>

        {match(data.mock)
          .with(true, () => (
            <p className="mt-2 text-center text-xs text-ink-faint">
              Running against the offline stand-in — no third-party account needed.
            </p>
          ))
          .with(false, () => null)
          .exhaustive()}

        <Divider />
      </>
    ));
};

const Divider = () => (
  <div className="my-5 flex items-center gap-3">
    <span className="h-px flex-1 bg-line" />
    <span className="text-xs uppercase tracking-wider text-ink-faint">or</span>
    <span className="h-px flex-1 bg-line" />
  </div>
);

/* --------------------------------------------------------------- register */

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
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
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

export const LoginPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failure, setFailure] = useState<Option<ReactNode>>(
    // The OAuth callback redirects here with a reason when it fails.
    Option.map((code: string) => `Sign-in failed (${code}). Please try again.`)(
      Option.fromNullable(params.get("error")),
    ),
  );

  const form = useForm({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .postWithoutRetry<LoginOutcome>("/auth/login", values)
      .then((outcome) =>
        match(outcome)
          .with({ status: "authenticated" }, ({ grant }) => {
            tokenStore.set(grant.accessToken, grant.user);
            void navigate("/");
          })
          .with({ status: "two_factor_required" }, ({ challengeToken }) => {
            // The challenge is short-lived and single-purpose; the history
            // entry is replaced so Back does not return to a spent form.
            void navigate("/login/2fa", {
              state: { challengeToken },
              replace: true,
            });
          })
          .exhaustive(),
      )
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
  });

  return (
    <AuthShell
      title="Sign in"
      lede="Welcome back to the colour shop."
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
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register("password")}
        />

        <div className="flex justify-end">
          <Link
            to="/forgot-password"
            className="text-sm font-medium text-accent hover:underline"
          >
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

/* ------------------------------------------------------------ second factor */

export const TwoFactorPage = () => {
  const navigate = useNavigate();
  const [failure, setFailure] = useState<Option<ReactNode>>(Option.none);

  // Carried in navigation state rather than the URL: a challenge token in the
  // address bar ends up in history and in any referrer header.
  const challengeToken =
    typeof history.state === "object" &&
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
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
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

/* -------------------------------------------------------- password recovery */

const forgotSchema = z.object({ email: z.string().min(1) });

export const ForgotPasswordPage = () => {
  const [sent, setSent] = useState(false);
  const form = useForm({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    // Always reports success. Whether the address exists is not this
    // endpoint's business to reveal.
    await api.postEmpty("/auth/password/forgot", values).catch(() => undefined);
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
            If that address has an account, a reset link is on its way. It expires
            in 30 minutes.
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

export const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [failure, setFailure] = useState<Option<ReactNode>>(Option.none);
  const [done, setDone] = useState(false);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token: params.get("token") ?? "", password: "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(Option.none);

    await api
      .postEmptyWithoutRetry("/auth/password/reset", values)
      .then(() => {
        // Every session was revoked server-side, so the visitor signs in fresh.
        tokenStore.clear();
        setDone(true);
        setTimeout(() => void navigate("/login"), 2200);
      })
      .catch((reason: unknown) => setFailure(Option.some(describe(reason))));
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

export const OAuthCompletePage = () => {
  const navigate = useNavigate();

  // The callback set a refresh cookie and sent us here with no token in the
  // URL. Trading the cookie for an access token is what `useSessionBootstrap`
  // already does on mount, so this page only has to wait and move on.
  useState(() => {
    setTimeout(() => void navigate("/", { replace: true }), 400);
  });

  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <p className="text-sm text-ink-soft">Signing you in…</p>
    </div>
  );
};
