import { CategoryInput, type AdminCategory } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Field, IssueList, TextAreaField } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { ServerIssues, Slugs } from "../forms.ts";

/** The category being changed, or none for a new one; what saving does; and how to leave without saving. */
export type CategoryFormProps = Readonly<{
  initial?: AdminCategory;
  onSave: (input: CategoryInput) => Promise<unknown>;
  onCancel: () => void;
}>;

/** A category's name, its slug, which a new one takes from its name, and what its page says about it. */
export const CategoryForm = ({ initial, onSave, onCancel }: CategoryFormProps) => {
  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [isSlugTyped, setSlugTyped] = useState(initial !== undefined);

  const form = useForm({
    resolver: zodResolver(CategoryInput.schema),
    defaultValues: { name: initial?.name ?? "", slug: initial?.slug ?? "", description: initial?.description ?? "" },
  });

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await onSave(values).catch((reason: unknown) => {
      const found = Api.failureOf(reason);
      if (found === undefined || found.issues.length === 0) {
        setFailure(Failure.message(reason));
        return;
      }
      const unplaced = ServerIssues.place(found.issues, ["name", "slug", "description"], form.setError);
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
        id="category-name"
        error={form.formState.errors.name?.message}
        {...form.register("name", {
          onChange: (event: { target: { value: string } }) => {
            if (isSlugTyped) return;

            form.setValue("slug", Slugs.fromName(event.target.value));
          },
        })}
      />
      <Field
        label="Slug"
        id="category-slug"
        hint="The category's address: /categories/ and this."
        error={form.formState.errors.slug?.message}
        {...form.register("slug", { onChange: () => setSlugTyped(true) })}
      />
      <TextAreaField
        label="Description (optional)"
        id="category-description"
        rows={4}
        hint="Shown under the category's heading, and read by search engines."
        error={form.formState.errors.description?.message}
        {...form.register("description")}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={form.formState.isSubmitting}>
          {initial === undefined ? "Create category" : "Save category"}
        </Button>
      </div>
    </form>
  );
};
