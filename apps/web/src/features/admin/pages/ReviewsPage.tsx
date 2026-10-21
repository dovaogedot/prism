import { ReviewStatus, type AdminReviewView, type Page } from "@prism/shared";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { match, P } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, ConfirmDialog, Dialog, EmptyState, Pagination, Skeleton, Stars, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { CatalogParams } from "../../catalog/filters.ts";
import { OrderTime } from "../../orders/orders.ts";
import { AdminKeys, useAdminRead, useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";
import { RejectForm } from "../components/RejectForm.tsx";

/**
 * The moderation queue: reviews waiting for a moderator first, and those
 * already approved or rejected a tab away. A review is approved, rejected
 * with a reason its author reads, or deleted, and deleting asks first.
 */
export const ReviewsPage = () => {
  const [params, setParams] = useSearchParams();

  const status = ReviewStatus.schema.catch("pending").parse(params.get("status") ?? "pending");
  const query = params.toString();

  const reviews = useAdminRead<Page<AdminReviewView>>(AdminKeys.list("reviews", query), `/reviews${query.length === 0 ? "" : `?${query}`}`);

  const [rejecting, setRejecting] = useState<AdminReviewView | undefined>(undefined);

  const [deleting, setDeleting] = useState<AdminReviewView | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const approve = useAdminWrite((id: string) => Api.postEmpty(`/admin/reviews/${id}/approve`));

  const reject = useAdminWrite((change: Readonly<{ id: string; reason: string }>) => Api.postEmpty(`/admin/reviews/${change.id}/reject`, { reason: change.reason }));

  const remove = useAdminWrite((id: string) => Api.requestEmpty(`/admin/reviews/${id}`, { method: "DELETE" }));

  const refused = (reason: unknown): void => setFailure(Failure.message(reason));

  return (
    <AdminPage text={PageText.adminReviews} heading="Reviews">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
        {ReviewStatus.NAMES.map((name) => (
          <button
            className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${name === status ? "border-accent bg-accent-wash text-ink" : "border-line text-ink-soft hover:border-line-strong"}`}
            key={name}
            type="button"
            aria-pressed={name === status}
            onClick={() => setParams(new URLSearchParams({ status: name }))}
          >
            {ReviewStatus.label[name]}
          </button>
        ))}
      </div>

      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {match(reviews)
        .with({ status: "error" }, ({ error }) => <Alert>{Failure.message(error)}</Alert>)
        .with({ data: P.nullish }, () => <Skeleton className="h-96 w-full" />)
        .when(
          ({ data }) => data.items.length === 0,
          () => <EmptyState title={status === "pending" ? "No reviews are waiting." : "No reviews here."} />,
        )
        .otherwise(({ data }) => (
          <>
            <ul className="space-y-4">
              {data.items.map((review) => (
                <li className="space-y-2 rounded-lg border border-line bg-surface p-5" key={review.id}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link className="font-medium text-accent underline-offset-2 hover:underline" to={`/products/${review.product.slug}`}>
                      {review.product.name}
                    </Link>
                    <span className="text-sm text-ink-soft">{OrderTime.format(review.createdAt)}</span>
                  </div>
                  <Stars rating={review.rating} count={1} isCountShown={false} />
                  {review.title === undefined ? null : <h2 className="font-semibold text-ink">{review.title}</h2>}
                  {review.body === undefined ? null : <p className="whitespace-pre-line text-ink">{review.body}</p>}
                  <p className="text-sm text-ink-soft">Signed {review.authorName}</p>
                  {review.rejectionReason === undefined ? null : <p className="text-sm text-danger">Rejected: {review.rejectionReason}</p>}
                  <div className="flex flex-wrap gap-2 pt-1">
                    {review.status === "approved" ? null : (
                      <Button type="button" busy={approve.isPending && approve.variables === review.id} onClick={() => approve.mutate(review.id, { onSuccess: () => Toast.show("The review is published."), onError: refused })}>
                        Approve
                      </Button>
                    )}
                    {review.status === "rejected" ? null : (
                      <Button tone="quiet" type="button" onClick={() => setRejecting(review)}>
                        Reject
                      </Button>
                    )}
                    <Button tone="ghost" type="button" onClick={() => setDeleting(review)}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} label="Review pages" onPage={(page) => setParams(CatalogParams.set(params, "page", String(page)))} />
          </>
        ))}

      <Dialog isOpen={rejecting !== undefined} title="Reject this review?" onClose={() => setRejecting(undefined)}>
        {rejecting === undefined ? null : (
          <RejectForm
            key={rejecting.id}
            isBusy={reject.isPending}
            onCancel={() => setRejecting(undefined)}
            onReject={(reason) =>
              reject.mutate(
                { id: rejecting.id, reason },
                {
                  onSuccess: () => {
                    setRejecting(undefined);
                    Toast.show("The review is rejected, and its author can see why.");
                  },
                  onError: (error) => {
                    setRejecting(undefined);
                    refused(error);
                  },
                },
              )
            }
          />
        )}
      </Dialog>

      <ConfirmDialog
        isOpen={deleting !== undefined}
        title="Delete this review?"
        confirmLabel="Delete review"
        isBusy={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting === undefined) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(undefined);
              Toast.show("The review is deleted.");
            },
            onError: (error) => {
              setDeleting(undefined);
              refused(error);
            },
          });
        }}
      >
        It goes for good, with its helpful votes, and the product's rating no longer counts it. Its author can write a new one.
      </ConfirmDialog>
    </AdminPage>
  );
};
