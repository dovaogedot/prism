import { ProfileInput, type Profile } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Alert, Button, Field, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useAccountChanges } from "../account.ts";

/** The profile as the server has it. */
export type ProfileFormProps = Readonly<{ profile: Profile }>;

/**
 * The customer's name and phone, which checkout starts from. The email is
 * shown but stays as it is: changing it would need a confirmation the shop
 * does not have.
 */
export const ProfileForm = ({ profile }: ProfileFormProps) => {
  const { saveProfile } = useAccountChanges();

  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(ProfileInput.schema),
    defaultValues: { fullName: profile.fullName ?? "", phone: profile.phone ?? "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await saveProfile
      .mutateAsync(values)
      .then((saved) => {
        form.reset({ fullName: saved.fullName ?? "", phone: saved.phone ?? "" });
        Toast.show("Your profile is saved.");
      })
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-ink">Email address</p>
        <p className="rounded-lg border border-line bg-sunken px-3 py-2.5 text-sm text-ink-soft">{profile.email}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" autoComplete="name" error={form.formState.errors.fullName?.message} {...form.register("fullName")} />
        <Field label="Phone" type="tel" autoComplete="tel" error={form.formState.errors.phone?.message} {...form.register("phone")} />
      </div>

      <Button type="submit" busy={form.formState.isSubmitting}>
        Save profile
      </Button>
    </form>
  );
};
