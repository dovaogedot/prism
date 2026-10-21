import { BrandInput, type AdminBrand } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field, IssueList } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { ServerIssues, Slugs } from "../forms.ts";

/** The brand being changed, or none for a new one; what saving does; and how to leave without saving. */
export type BrandFormProps = Readonly<{
  initial?: AdminBrand;
  onSave: (input: BrandInput) => Promise<unknown>;
  onCancel: () => void;
}>;

/** A brand's name and its slug, which a new one takes from its name. */
export const BrandForm = ({ initial, onSave, onCancel }: BrandFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [isSlugTyped, setSlugTyped] = useState(initial !== undefined);

  const form = useForm({
    resolver: zodResolver(BrandInput.schema),
    defaultValues: { name: initial?.name ?? "", slug: initial?.slug ?? "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await onSave(values).catch((reason: unknown) => {
      const found = Api.failureOf(reason);
      if (found === undefined || found.issues.length === 0) {
        setFailure(Failure.message(reason));
        return;
      }
      const unplaced = ServerIssues.place(found.issues, ["name", "slug"], form.setError);
      if (unplaced.length > 0) {
        setFailure(<IssueList issues={unplaced} />);
      }
    });
  });

  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      {failure === undefined ? null : <Alert>{failure}</Alert>}
      <Field
        label="Name"
        id="brand-name"
        error={form.formState.errors.name?.message}
        {...form.register("name", {
          onChange: (event: { target: { value: string } }) => {
            if (isSlugTyped) return;

            form.setValue("slug", Slugs.fromName(event.target.value));
          },
        })}
      />
      <Field label="Slug" id="brand-slug" error={form.formState.errors.slug?.message} {...form.register("slug", { onChange: () => setSlugTyped(true) })} />
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={form.formState.isSubmitting}>
          {initial === undefined ? "Create brand" : "Save brand"}
        </Button>
      </div>
    </form>
  );
};
