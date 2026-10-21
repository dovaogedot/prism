import { ReviewInput, type ReviewViewer } from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Alert, Button, ConfirmDialog, Field, TextAreaField, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { ReviewNotice, useReviewChanges } from "../reviews.ts";

/** The product, and what the reader may do with its reviews. */
export type ReviewFormProps = Readonly<{ slug: string; viewer: ReviewViewer }>;

/**
 * Writing or changing the reader's review: the stars, the name to sign it
 * with, a title and the text. Above it, what became of the review already
 * written, or why there is no form.
 */
export const ReviewForm = ({ slug, viewer }: ReviewFormProps) => {
  const { save, remove } = useReviewChanges(slug);

  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [isConfirming, setConfirming] = useState(false);

  const own = viewer.own;

  const form = useForm({
    resolver: zodResolver(ReviewInput.schema),
    defaultValues: {
      ...(own === undefined ? {} : { rating: own.rating }),
      authorName: own?.authorName ?? viewer.suggestedAuthorName ?? "",
      title: own?.title ?? "",
      body: own?.body ?? "",
    },
  });

  const rating = useWatch({ control: form.control, name: "rating" });

  const notice = ReviewNotice.of(viewer);

  const submit = form.handleSubmit(async (values) => {
    setFailure(undefined);

    await save
      .mutateAsync(values)
      .then(() => Toast.show("Thank you. Your review is waiting for a moderator."))
      .catch((reason: unknown) => setFailure(Failure.describe(reason)));
  });

  const errors = form.formState.errors;

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-5">
      <h3 className="font-semibold text-ink">{own === undefined ? "Write a review" : "Your review"}</h3>

      {notice === undefined ? null : (
        <Alert tone={notice.tone} title={notice.title}>
          {notice.text}
        </Alert>
      )}

      {viewer.canReview ? (
        <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
          {failure === undefined ? null : <Alert>{failure}</Alert>}

          <fieldset aria-describedby={errors.rating === undefined ? undefined : "review-rating-error"}>
            <legend className="mb-1.5 text-sm font-medium text-ink">Your rating</legend>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map((stars) => (
                <label className="cursor-pointer rounded p-0.5 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent" key={stars}>
                  <input
                    className="sr-only"
                    type="radio"
                    name="rating"
                    value={stars}
                    checked={rating === stars}
                    onChange={() => form.setValue("rating", stars, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
                  />
                  <span className="sr-only">{stars === 1 ? "1 star" : `${stars} stars`}</span>
                  <svg
                    className={`size-7 ${rating !== undefined && stars <= rating ? "text-accent" : "text-line-strong"}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M10 1.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L10 14.9 4.7 17.6l1-5.8L1.5 7.7l5.9-.9z" />
                  </svg>
                </label>
              ))}
            </div>
            {errors.rating?.message === undefined ? null : (
              <p className="mt-1 text-sm text-danger" id="review-rating-error" role="alert">
                {errors.rating.message}
              </p>
            )}
          </fieldset>

          <Field label="Sign it as" hint="Shown with your review instead of your email." error={errors.authorName?.message} {...form.register("authorName")} />
          <Field label="Title (optional)" error={errors.title?.message} {...form.register("title")} />
          <TextAreaField label="Your review (optional)" error={errors.body?.message} {...form.register("body")} />

          <div className="flex flex-wrap gap-2">
            <Button type="submit" busy={form.formState.isSubmitting}>
              {own === undefined ? "Send review" : "Send changes"}
            </Button>
            {own === undefined ? null : (
              <Button tone="ghost" type="button" onClick={() => setConfirming(true)}>
                Delete review
              </Button>
            )}
          </div>
        </form>
      ) : null}

      <ConfirmDialog
        isOpen={isConfirming}
        title="Delete your review?"
        confirmLabel="Delete review"
        isBusy={remove.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          remove.mutate(undefined, {
            onSuccess: () => {
              setConfirming(false);
              form.reset({ authorName: viewer.suggestedAuthorName ?? "", title: "", body: "" });
              Toast.show("Your review is deleted.");
            },
            onError: (reason) => {
              setConfirming(false);
              setFailure(Failure.describe(reason));
            },
          })
        }
      >
        The review and its helpful votes go for good. You can write a new one afterwards.
      </ConfirmDialog>
    </div>
  );
};
