import { Password, ResetPasswordForm, ResetToken } from "@prism/shared"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useSearchParams } from "react-router"
import { match, P } from "ts-pattern"
import { Api } from "../../../shared/api/client.ts"
import { Alert, Button, Field } from "../../../shared/ui/index.ts"
import { AuthShell } from "../components/index.ts"
import { Failure } from "../../../shared/api/failure.tsx"
import { TokenStore } from "../../../shared/api/token-store.ts"
import { PageMeta } from "../../../shared/seo/PageMeta.tsx"
import { PageText } from "../../../shared/seo/page-text.ts"
import { useRecheck } from "../../../shared/hooks/use-recheck.ts"

/** Choosing a new password against a token from an email. A link without its token says so and offers a new one. */
export const ResetPasswordPage = () => {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined)
  const [done, setDone] = useState(false)

  const token = ResetToken.schema.safeParse(params.get("token")).data

  const form = useForm({
    mode: "onTouched",
    resolver: zodResolver(ResetPasswordForm.schema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  useRecheck(form, "password", "confirmPassword")

  const submit = form.handleSubmit(async (values) => {
    if (token === undefined) return

    setFailure(undefined)

    // The confirmation is a browser-side typo guard; the server has no use for it.
    await Api.postEmptyWithoutRetry("/auth/password/reset", {
      token,
      password: values.password,
    })
      .then(() => {
        // Every session was revoked server-side, so the visitor signs in fresh.
        TokenStore.clear()
        setDone(true)
        setTimeout(() => void navigate("/login"), 2200)
      })
      .catch((reason: unknown) => setFailure(Failure.describe(reason)))
  })

  return (
    <AuthShell
      title="Choose a new password"
      lede="This also signs you out everywhere else."
      footer={
        <Link to="/forgot-password" className="font-medium text-accent underline underline-offset-2">
          Ask for a new link
        </Link>
      }
    >
      <PageMeta title={PageText.resetPassword.title} description={PageText.resetPassword.description} isIndexed={false} />
      {match({ done, token })
        .with({ token: P.nullish }, () => (
          <Alert title="This link is incomplete">
            The address is missing its code, which happens when an email app cuts a long link. Open the link from the email again, or ask
            for a new one.
          </Alert>
        ))
        .with({ done: true }, () => (
          <Alert tone="accent" title="Password changed">
            Taking you to the sign-in page…
          </Alert>
        ))
        .otherwise(() => (
          <form onSubmit={(event) => void submit(event)} className="space-y-4" noValidate>
            {match(failure)
              .with(P.nullish, () => null)
              .otherwise((message) => (
                <Alert>{message}</Alert>
              ))}

            <Field
              label="New password"
              type="password"
              autoComplete="new-password"
              hint={`At least ${Password.MIN_LENGTH} characters.`}
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
        ))}
    </AuthShell>
  )
}
