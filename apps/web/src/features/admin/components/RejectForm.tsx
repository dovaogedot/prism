import { RejectReviewInput } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button, TextAreaField } from "../../../shared/ui/index.ts";

/** What rejecting does with the reason, and how to leave without rejecting. */
export type RejectFormProps = Readonly<{ isBusy: boolean; onReject: (reason: string) => void; onCancel: () => void }>;

/** The reason a review is not published, which its author reads. */
export const RejectForm = ({ isBusy, onReject, onCancel }: RejectFormProps) => {
  const form = useForm({ resolver: zodResolver(RejectReviewInput.schema), defaultValues: { reason: "" } });

  return (
    <form className="space-y-4" onSubmit={(event) => void form.handleSubmit((values) => onReject(values.reason))(event)} noValidate>
      <TextAreaField
        label="Reason for the author"
        id="reject-reason"
        rows={3}
        hint="The author sees this next to their review, and can change it and send it again."
        error={form.formState.errors.reason?.message}
        {...form.register("reason")}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button tone="danger" type="submit" busy={isBusy}>
          Reject review
        </Button>
      </div>
    </form>
  );
};
