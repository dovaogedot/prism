import { ImageAlt, type ImageId, type ProductId, type ProductImage } from "@prism/shared"
import { zodResolver } from "@hookform/resolvers/zod"
import { useState, type ReactNode } from "react"
import { useForm } from "react-hook-form"
import { Api } from "../../../shared/api/client.ts"
import { Alert, Button, Card, ConfirmDialog, Field, ImageSet, Toast } from "../../../shared/ui/index.ts"
import { Failure } from "../../../shared/api/failure.tsx"
import { ServerIssues } from "../../../shared/ui/server-issues.ts"
import { useAdminWrite } from "../admin.ts"
import { PictureUploadForm } from "../forms.ts"
import { PictureDrafts, type PictureDraft } from "../picture-drafts.ts"

/** The product the pictures belong to, and its pictures in their order. */
export type ProductImagesProps = Readonly<{ productId: ProductId; images: readonly ProductImage[] }>

/**
 * A product's pictures: their order, which the first leads, and the text
 * that describes each one for people who cannot see it. A new picture is
 * uploaded with its text; the server re-encodes it, which drops what the
 * camera wrote into it, and makes its smaller copies. A missing or too long
 * text is named under its field.
 */
export const ProductImages = ({ productId, images }: ProductImagesProps) => {
  const [drafts, setDrafts] = useState<readonly PictureDraft[]>(() => PictureDrafts.of(images))

  // The pictures whose text is checked: each once its field is left, and every one once a save is tried.
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<ImageId>>(() => new Set())

  const [deleting, setDeleting] = useState<ProductImage | undefined>(undefined)

  const [failure, setFailure] = useState<ReactNode | undefined>(undefined)

  const [shown, setShown] = useState(images)

  const uploadForm = useForm({
    mode: "onTouched",
    resolver: zodResolver(PictureUploadForm.schema),
    defaultValues: { alt: "", isPixelArt: false },
  })

  // A new server list, after an upload or a delete, keeps the unsaved order and texts.
  if (shown !== images) {
    setShown(images)
    setDrafts(PictureDrafts.merge(drafts, shown, images))
  }

  const save = useAdminWrite(() =>
    Api.put<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images`, {
      images: drafts.map((draft) => ({ id: draft.image.id, alt: draft.alt })),
    }),
  )

  const upload = useAdminWrite((form: FormData) =>
    Api.post<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images`, form),
  )

  const remove = useAdminWrite((imageId: string) =>
    Api.request<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images/${imageId}`, { method: "DELETE" }),
  )

  const move = (index: number, offset: number): void => {
    const target = index + offset
    if (target < 0 || target >= drafts.length) return

    const next = [...drafts]
    const [moved] = next.splice(index, 1)
    if (moved !== undefined) {
      next.splice(target, 0, moved)
    }
    setDrafts(next)
  }

  /** What is wrong with a picture's text once it is checked; `undefined` before then and while nothing is. */
  const checkAlt = (draft: PictureDraft): string | undefined =>
    checkedIds.has(draft.image.id) ? ImageAlt.schema.safeParse(draft.alt).error?.issues[0]?.message : undefined

  const submitUpload = uploadForm.handleSubmit(async (values) => {
    const body = new FormData()
    body.append("alt", values.alt)
    body.append("isPixelArt", String(values.isPixelArt))
    body.append("file", values.file)
    setFailure(undefined)

    await upload.mutateAsync(body).then(
      () => {
        uploadForm.reset()
        Toast.show("The picture is added.")
      },
      (reason: unknown) => {
        // A file the server cannot read, or one too large, is refused as a whole, which is about the file.
        const code = Api.failureOf(reason)?.code
        if (code === "UnsupportedImage" || code === "PayloadTooLarge") {
          uploadForm.setError("file", { message: Failure.message(reason) }, { shouldFocus: true })
          return
        }

        setFailure(Failure.describeUnplaced(reason, (issues) => ServerIssues.place(issues, ["file", "alt"], uploadForm.setError)))
      },
    )
  })

  const isChanged = drafts.some((draft, index) => draft.image.id !== images[index]?.id || draft.alt !== images[index].alt)
  const fileError = uploadForm.formState.errors.file?.message

  return (
    <Card className="space-y-5 p-5">
      <h2 className="font-semibold text-ink">Pictures</h2>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {drafts.length === 0 ? (
        <p className="text-sm text-ink-soft">No pictures yet. The shop shows the first letter of the name instead.</p>
      ) : null}

      {/* Wide enough for one row, the picture and the buttons line up with the
          text's field by its label's height, so a message under the field
          moves neither; a narrower list wraps them onto lines of their own. */}
      <ol className="@container space-y-3">
        {drafts.map((draft, index) => (
          <li
            className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3 @lg:flex-nowrap @lg:items-start"
            key={draft.image.id}
          >
            <ImageSet
              className="size-16 shrink-0 rounded bg-sunken object-contain @lg:mt-1"
              image={draft.image}
              sizes="4rem"
              isDecorative
            />
            <div className="min-w-48 flex-1">
              <Field
                label={index === 0 ? "Describe the main picture" : `Describe picture ${index + 1}`}
                id={`alt-${draft.image.id}`}
                value={draft.alt}
                error={checkAlt(draft)}
                onChange={(event) =>
                  setDrafts(drafts.map((candidate) => (candidate === draft ? { ...candidate, alt: event.target.value } : candidate)))
                }
                onBlur={() => setCheckedIds((ids) => new Set(ids).add(draft.image.id))}
              />
            </div>
            <div className="flex gap-1 @lg:mt-6.5">
              <Button
                tone="quiet"
                type="button"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move picture ${index + 1} up`}
              >
                ↑
              </Button>
              <Button
                tone="quiet"
                type="button"
                disabled={index === drafts.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move picture ${index + 1} down`}
              >
                ↓
              </Button>
              <Button tone="ghost" type="button" onClick={() => setDeleting(draft.image)}>
                Delete<span className="sr-only"> picture {index + 1}</span>
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {drafts.length === 0 ? null : (
        <Button
          type="button"
          disabled={!isChanged}
          busy={save.isPending}
          onClick={() => {
            // Every text is checked, and the first one missing takes focus, as a form does on submit.
            const missing = drafts.find((draft) => !ImageAlt.schema.safeParse(draft.alt).success)
            if (missing !== undefined) {
              setCheckedIds(new Set(drafts.map((draft) => draft.image.id)))
              document.getElementById(`alt-${missing.image.id}`)?.focus()
              return
            }
            setFailure(undefined)
            save.mutate(undefined, {
              onSuccess: () => Toast.show("The pictures are saved."),
              onError: (reason) => setFailure(Failure.describe(reason)),
            })
          }}
        >
          Save order and texts
        </Button>
      )}

      <form className="space-y-3 border-t border-line pt-5" onSubmit={(event) => void submitUpload(event)} noValidate>
        <h3 className="text-sm font-semibold text-ink">Add a picture</h3>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink" htmlFor="image-file">
            Picture file
          </label>
          <input
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-edge file:bg-sunken file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            id="image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-invalid={fileError !== undefined}
            aria-describedby={fileError === undefined ? "image-file-hint" : "image-file-hint image-file-error"}
            {...uploadForm.register("file")}
          />
          <p className="text-sm text-ink-faint" id="image-file-hint">
            JPEG, PNG or WebP, up to 10 MB.
          </p>
          {fileError === undefined ? null : (
            <p className="text-sm text-danger" id="image-file-error" role="alert">
              {fileError}
            </p>
          )}
        </div>
        <Field
          label="Describe the picture"
          id="image-alt"
          error={uploadForm.formState.errors.alt?.message}
          {...uploadForm.register("alt")}
        />
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input className="size-4 accent-[var(--color-accent)]" type="checkbox" {...uploadForm.register("isPixelArt")} />
          Pixel art: keep its pixels sharp when it is scaled
        </label>
        <Button tone="quiet" type="submit" busy={uploadForm.formState.isSubmitting}>
          Upload
        </Button>
      </form>

      <ConfirmDialog
        isOpen={deleting !== undefined}
        title="Delete this picture?"
        confirmLabel="Delete picture"
        isBusy={remove.isPending}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => {
          if (deleting === undefined) return
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(undefined)
              Toast.show("The picture is deleted.")
            },
            onError: (reason) => {
              setDeleting(undefined)
              setFailure(Failure.describe(reason))
            },
          })
        }}
      >
        It is removed from the product and from the shop's storage, with its smaller copies.
      </ConfirmDialog>
    </Card>
  )
}
