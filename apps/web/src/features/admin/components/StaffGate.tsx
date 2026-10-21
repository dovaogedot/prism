import type { AdminSummary } from "@prism/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Card, Spinner } from "../../../shared/ui/index.ts";
import { SignInFirst } from "../../auth/components/SignInFirst.tsx";
import { TwoFactorSetupFlow } from "../../auth/components/TwoFactorSetupFlow.tsx";
import { useSession } from "../../auth/session.ts";
import { AdminAccess, AdminKeys } from "../admin.ts";
import { StepUpForm } from "./StepUpForm.tsx";

/** The admin's pages, which open only past the gate. */
export type StaffGateProps = Readonly<{ children: ReactNode }>;

/**
 * Lets a staff member into the admin. A guest is sent to sign in. A
 * customer is told the admin is for staff. Staff without a second factor set
 * it up here, and staff whose last code is too old type a fresh one; the
 * API asks for both, and this is where the page answers.
 */
export const StaffGate = ({ children }: StaffGateProps) => {
  const session = useSession();

  const client = useQueryClient();

  const summary = useQuery({
    queryKey: AdminKeys.summary,
    queryFn: ({ signal }) => Api.get<AdminSummary>("/admin/summary", signal),
    enabled: session !== undefined,
    retry: false,
  });

  if (session === undefined) return <SignInFirst />;

  const reopen = (): void => {
    void client.invalidateQueries({ queryKey: AdminKeys.all });
  };

  const gate = summary.status === "error" ? AdminAccess.gateOf(Api.failureOf(summary.error)) : "open";
  const frameClass = "mx-auto max-w-lg space-y-6 px-4 py-14 sm:px-6";

  return match({ gate, status: summary.status })
    .with({ gate: "setup" }, () => (
      <div className={frameClass}>
        <PageMeta title={PageText.adminSetup.title} description={PageText.adminSetup.description} isIndexed={false} />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Set up two-factor authentication</h1>
        <p className="text-ink-soft">Staff accounts need a second factor. Set one up once, and the admin opens.</p>
        <Card className="p-5">
          <TwoFactorSetupFlow onDone={reopen} />
        </Card>
      </div>
    ))
    .with({ gate: "verify" }, () => (
      <div className={frameClass}>
        <PageMeta title={PageText.adminVerify.title} description={PageText.adminVerify.description} isIndexed={false} />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Confirm it is you</h1>
        <p className="text-ink-soft">The admin asks for a current code from your authenticator app every few hours.</p>
        <Card className="p-5">
          <StepUpForm onDone={reopen} />
        </Card>
      </div>
    ))
    .with({ gate: "forbidden" }, () => (
      <div className={frameClass}>
        <PageMeta title={PageText.adminForbidden.title} description={PageText.adminForbidden.description} isIndexed={false} />
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Staff only</h1>
        <p className="text-ink-soft">
          The admin is for the shop's staff.{" "}
          <Link className="font-medium text-accent underline underline-offset-2" to="/">
            Back to the shop
          </Link>
        </p>
      </div>
    ))
    .with({ status: "error" }, () => (
      <div className={frameClass}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">The admin did not open</h1>
        <Alert>Something went wrong at our end. Try again in a moment.</Alert>
      </div>
    ))
    .with({ status: "pending" }, () => (
      <div className={`${frameClass} flex items-center gap-3 text-ink-soft`}>
        <Spinner />
        <h1 className="text-base font-medium">Opening the admin…</h1>
      </div>
    ))
    .otherwise(() => children);
};
