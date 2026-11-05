/**
 * Turning on two-factor sign-in. Enrollment is two steps: the secret is
 * stored when setup begins, but 2FA is not active until a live code proves
 * the secret reached an authenticator app. Otherwise a mistyped scan would
 * lock the account out.
 */

import { EnableTwoFactorInput, type SessionUser, type TwoFactorSetup } from "@prism/shared"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { match, P } from "ts-pattern"
import { Api } from "../../../shared/api/client.ts"
import { Alert, Button, Field } from "../../../shared/ui/index.ts"
import { SetupKey } from "../setup-key.ts"
import { TokenStore } from "../../../shared/api/token-store.ts"
import { Failure } from "../../../shared/api/failure.tsx"

export type TwoFactorSetupFlowProps = Readonly<{
  /** Whether the account has a password, which turning 2FA on then asks for. */
  hasPassword: boolean
  /** What happens once two-factor sign-in is on. */
  onDone: () => void
}>

export const TwoFactorSetupFlow = ({ hasPassword, onDone }: TwoFactorSetupFlowProps) => {
  const [setup, setSetup] = useState<TwoFactorSetup | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const [starting, setStarting] = useState(false)

  const form = useForm({
    mode: "onTouched",
    resolver: zodResolver(hasPassword ? EnableTwoFactorInput.withPassword : EnableTwoFactorInput.schema),
    defaultValues: hasPassword ? { code: "", currentPassword: "" } : { code: "" },
  })

  const begin = async (): Promise<void> => {
    setStarting(true)
    setFailure(undefined)

    await Api.post<TwoFactorSetup>("/auth/2fa/setup")
      .then((result) => setSetup(result))
      .catch((reason: unknown) => setFailure(Failure.message(reason)))
      .finally(() => setStarting(false))
  }

  const confirm = form.handleSubmit(async (values) => {
    setFailure(undefined)

    await Api.post<SessionUser>("/auth/2fa/enable", values)
      .then((user) => {
        TokenStore.updateUser(user)
        onDone()
      })
      .catch((reason: unknown) => setFailure(Failure.message(reason)))
  })

  return (
    <div className="space-y-4">
      {match(failure)
        .with(P.nullish, () => null)
        .otherwise((message) => (
          <Alert>{message}</Alert>
        ))}

      {match(setup)
        .with(P.nullish, () => (
          <>
            <p className="text-sm text-ink-soft">Adds a six-digit code from an authenticator app to every sign-in.</p>
            <Button busy={starting} onClick={() => void begin()}>
              Set up two-factor authentication
            </Button>
          </>
        ))
        .otherwise((value) => {
          const groups = SetupKey.splitIntoGroups(value.uri)

          return (
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">
                Scan this with your authenticator app, then type the code it shows to confirm it worked.
              </p>

              <div className="flex flex-col items-start gap-4 sm:flex-row">
                <img
                  className="w-40 shrink-0 rounded-lg border border-line bg-white p-3"
                  // The server draws the SVG from the key alone, black on clear paper; the white box keeps it scannable in dark mode.
                  src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(value.qrCodeSvg)}`}
                  alt="QR code that sets up two-factor authentication in an authenticator app"
                />

                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-faint">Or enter this setup key in the app</p>
                  <code className="block break-all rounded-lg bg-sunken px-3 py-2 font-mono text-sm text-ink">
                    {groups === undefined
                      ? value.uri
                      : groups.map((group, index) => (
                          // A margin, not a space, parts the groups, so a copied key pastes into the app as it is.
                          <span className="mr-[1ch] last:mr-0" key={index}>
                            {group}
                          </span>
                        ))}
                  </code>
                  <p className="text-sm">
                    <a className="text-accent underline underline-offset-2" href={value.uri}>
                      Open it in an authenticator app on this device
                    </a>
                  </p>
                </div>
              </div>

              <form className="space-y-4" onSubmit={(event) => void confirm(event)} noValidate>
                {hasPassword ? (
                  <Field
                    label="Current password"
                    type="password"
                    autoComplete="current-password"
                    className="max-w-sm"
                    error={form.formState.errors.currentPassword?.message}
                    {...form.register("currentPassword")}
                  />
                ) : null}
                <Field
                  label="Code from the app"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="max-w-40 text-center font-mono text-lg tracking-[0.3em]"
                  error={form.formState.errors.code?.message}
                  action={
                    <Button type="submit" busy={form.formState.isSubmitting}>
                      Turn it on
                    </Button>
                  }
                  {...form.register("code")}
                />
              </form>
            </div>
          )
        })}
    </div>
  )
}
