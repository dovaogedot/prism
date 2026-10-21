import { useState, type ReactNode } from "react";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Card, Skeleton } from "../../../shared/ui/index.ts";
import { PasswordFlow } from "../../auth/components/PasswordFlow.tsx";
import { SignInFirst } from "../../auth/components/SignInFirst.tsx";
import { TwoFactorDisableFlow } from "../../auth/components/TwoFactorDisableFlow.tsx";
import { TwoFactorSetupFlow } from "../../auth/components/TwoFactorSetupFlow.tsx";
import { useSession } from "../../auth/session.ts";
import { useProfile } from "../account.ts";
import { AccountPage } from "../components/AccountPage.tsx";
import { ProfileForm } from "../components/ProfileForm.tsx";

/**
 * The signed-in customer's own page: the profile checkout starts from, the
 * second factor, how they sign in, and the password. A guest is sent to sign
 * in first.
 */
export const ProfilePage = () => {
  const session = useSession();

  const profile = useProfile();

  const [notice, setNotice] = useState<ReactNode | undefined>(undefined);

  if (session === undefined) return <SignInFirst />;

  return (
    <AccountPage text={PageText.account} heading="Your account">

      {notice === undefined ? null : <Alert tone="accent">{notice}</Alert>}

      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-ink">Profile</h2>
        {match(profile)
          .with({ status: "error" }, () => <Alert>The profile did not load. Try again in a moment.</Alert>)
          .with({ data: P.nonNullable.select() }, (found) => <ProfileForm profile={found} />)
          .otherwise(() => <Skeleton className="h-40 w-full" />)}
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="font-semibold text-ink">Two-factor authentication</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${session.twoFactorEnabled ? "bg-accent-wash text-ink" : "bg-sunken text-ink-soft"}`}>
            {session.twoFactorEnabled ? "On" : "Off"}
          </span>
        </div>

        {session.twoFactorEnabled ? (
          <TwoFactorDisableFlow onDone={() => setNotice("Two-factor authentication is now off.")} />
        ) : (
          <TwoFactorSetupFlow onDone={() => setNotice("Two-factor authentication is now on.")} />
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-2 font-semibold text-ink">Sign-in methods</h2>
        <ul className="space-y-1 text-sm text-ink-soft">
          {session.hasPassword ? <li>Email and password.</li> : null}
          {session.providers.map((provider) => (
            <li className="capitalize" key={provider}>
              {provider}.
            </li>
          ))}
        </ul>
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-semibold text-ink">Password</h2>
        <PasswordFlow
          hasPassword={session.hasPassword}
          onDone={() => setNotice(session.hasPassword ? "Password changed." : "Password set. You can now sign in with your email.")}
        />
      </Card>
    </AccountPage>
  );
};
