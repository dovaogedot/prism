import { OAuthProvider } from "@prism/shared"
import { match, P } from "ts-pattern"
import { PageText } from "../../../shared/seo/page-text.ts"
import { Alert, Card, Skeleton, Toast } from "../../../shared/ui/index.ts"
import { PasswordFlow, TwoFactorDisableFlow, TwoFactorSetupFlow } from "../../auth/components/index.ts"
import { useSignedInSession } from "../../auth/session.ts"
import { useProfile } from "../account.ts"
import { AccountPage, ProfileForm } from "../components/index.ts"

/**
 * The signed-in customer's own page: the profile checkout starts from, the
 * second factor, how they sign in, and the password. A guest is sent to sign
 * in first.
 */
export const ProfilePage = () => {
  const session = useSignedInSession()

  const profile = useProfile()

  return (
    <AccountPage text={PageText.account} heading="Your account">
      {/* Every change is confirmed with a toast, where it shows whichever card it was made in. */}
      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-ink">Profile</h2>
        {match(profile)
          .with({ status: "error" }, () => <Alert>The profile did not load. Try again in a moment.</Alert>)
          .with({ data: P.nonNullable.select() }, (found) => <ProfileForm profile={found} />)
          .otherwise(() => (
            <Skeleton className="h-40 w-full" />
          ))}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-ink">Two-factor authentication</h2>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${session.twoFactorEnabled ? "bg-accent-wash text-ink" : "bg-sunken text-ink-soft"}`}
          >
            {session.twoFactorEnabled ? "On" : "Off"}
          </span>
        </div>

        {session.twoFactorEnabled ? (
          <TwoFactorDisableFlow onDone={(notice) => Toast.show(notice)} />
        ) : (
          <TwoFactorSetupFlow hasPassword={session.hasPassword} onDone={() => Toast.show("Two-factor authentication is now on.")} />
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-semibold text-ink">Sign-in methods</h2>
        <ul className="space-y-1 text-sm text-ink-soft">
          {session.hasPassword ? <li>Email and password.</li> : null}
          {session.providers.map((provider) => (
            <li key={provider}>{OAuthProvider.label[provider]}.</li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-ink">Password</h2>
        <PasswordFlow
          hasPassword={session.hasPassword}
          onDone={() => Toast.show(session.hasPassword ? "Password changed." : "Password set. You can now sign in with your email.")}
        />
      </Card>
    </AccountPage>
  )
}
