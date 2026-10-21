import { ImageAlt, type ProductId, type ProductImage } from "@prism/shared";
import { useState, type ReactNode } from "react";
import { Api } from "../../../shared/api/client.ts";
import { Alert, Button, Card, ConfirmDialog, Field, ImageSet, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useAdminWrite } from "../admin.ts";

/** The product the pictures belong to, and its pictures in their order. */
export type ProductImagesProps = Readonly<{ productId: ProductId; images: readonly ProductImage[] }>;

/** A picture as the list edits it: its id, picture and the text that describes it. */
type Draft = Readonly<{ image: ProductImage; alt: string }>;

/**
 * A product's pictures: their order, which the first leads, and the text
 * that describes each one for people who cannot see it. A new picture is
 * uploaded with its text; the server re-encodes it, which drops what the
 * camera wrote into it, and makes its smaller copies.
 */
export const ProductImages = ({ productId, images }: ProductImagesProps) => {
  const [drafts, setDrafts] = useState<readonly Draft[]>(() => images.map((image) => ({ image, alt: image.alt })));

  const [file, setFile] = useState<File | undefined>(undefined);

  const [alt, setAlt] = useState("");

  const [isPixelArt, setPixelArt] = useState(false);

  const [deleting, setDeleting] = useState<ProductImage | undefined>(undefined);

  const [failure, setFailure] = useState<ReactNode | undefined>(undefined);

  const [shown, setShown] = useState(images);

  // The server's list replaces the drafts whenever it changes.
  if (shown !== images) {
    setShown(images);
    setDrafts(images.map((image) => ({ image, alt: image.alt })));
  }

  const save = useAdminWrite(() =>
    Api.put<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images`, {
      images: drafts.map((draft) => ({ id: draft.image.id, alt: draft.alt })),
    }),
  );

  const upload = useAdminWrite((form: FormData) => Api.post<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images`, form));

  const remove = useAdminWrite((imageId: string) => Api.request<{ images: readonly ProductImage[] }>(`/admin/products/${productId}/images/${imageId}`, { method: "DELETE" }));

  const move = (index: number, offset: number): void => {
    const target = index + offset;
    if (target < 0 || target >= drafts.length) return;

    const next = [...drafts];
    const [moved] = next.splice(index, 1);
    if (moved !== undefined) {
      next.splice(target, 0, moved);
    }
    setDrafts(next);
  };

  const isChanged = drafts.some((draft, index) => draft.image.id !== images[index]?.id || draft.alt !== images[index].alt);

  return (
    <Card className="space-y-5 p-5">
      <h2 className="font-semibold text-ink">Pictures</h2>
      {failure === undefined ? null : <Alert>{failure}</Alert>}

      {drafts.length === 0 ? <p className="text-sm text-ink-soft">No pictures yet. The shop shows the first letter of the name instead.</p> : null}

      <ol className="space-y-3">
        {drafts.map((draft, index) => (
          <li className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3" key={draft.image.id}>
            <ImageSet className="size-16 shrink-0 rounded bg-sunken object-contain" image={draft.image} sizes="4rem" isDecorative />
            <div className="min-w-48 flex-1">
              <Field
                label={index === 0 ? "Describe the main picture" : `Describe picture ${index + 1}`}
                id={`alt-${draft.image.id}`}
                value={draft.alt}
                onChange={(event) => setDrafts(drafts.map((candidate) => (candidate === draft ? { ...candidate, alt: event.target.value } : candidate)))}
              />
            </div>
            <div className="flex gap-1">
              <Button tone="quiet" type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move picture ${index + 1} up`}>
                ↑
              </Button>
              <Button tone="quiet" type="button" disabled={index === drafts.length - 1} onClick={() => move(index, 1)} aria-label={`Move picture ${index + 1} down`}>
                ↓
              </Button>
              <Button tone="ghost" type="button" onClick={() => setDeleting(draft.image)}>
                Delete
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
            const missing = drafts.findIndex((draft) => !ImageAlt.schema.safeParse(draft.alt).success);
            if (missing >= 0) {
              setFailure(`Describe picture ${missing + 1}: every picture needs a text for people who cannot see it.`);
              return;
            }
            setFailure(undefined);
            save.mutate(undefined, { onSuccess: () => Toast.show("The pictures are saved."), onError: (reason) => setFailure(Failure.describe(reason)) });
          }}
        >
          Save order and texts
        </Button>
      )}

      <form
        className="space-y-3 border-t border-line pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          if (file === undefined) {
            setFailure("Choose a picture to upload.");
            return;
          }
          const form = new FormData();
          form.append("alt", alt);
          form.append("isPixelArt", String(isPixelArt));
          form.append("file", file);
          setFailure(undefined);
          upload.mutate(form, {
            onSuccess: () => {
              setFile(undefined);
              setAlt("");
              formElement.reset();
              Toast.show("The picture is added.");
            },
            onError: (reason) => setFailure(Failure.describe(reason)),
          });
        }}
      >
        <h3 className="text-sm font-semibold text-ink">Add a picture</h3>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink" htmlFor="image-file">
            Picture file
          </label>
          <input
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-sunken file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            id="image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-describedby="image-file-hint"
            onChange={(event) => setFile(event.target.files?.[0])}
          />
          <p className="text-sm text-ink-faint" id="image-file-hint">
            JPEG, PNG or WebP, up to 10 MB.
          </p>
        </div>
        <Field label="Describe the picture" id="image-alt" value={alt} onChange={(event) => setAlt(event.target.value)} />
        <label className="flex items-center gap-2.5 text-sm text-ink">
          <input className="size-4 accent-[var(--color-accent)]" type="checkbox" checked={isPixelArt} onChange={(event) => setPixelArt(event.target.checked)} />
          Pixel art: keep its pixels sharp when it is scaled
        </label>
        <Button tone="quiet" type="submit" busy={upload.isPending}>
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
          if (deleting === undefined) return;
          remove.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(undefined);
              Toast.show("The picture is deleted.");
            },
            onError: (reason) => {
              setDeleting(undefined);
              setFailure(Failure.describe(reason));
            },
          });
        }}
      >
        It is removed from the product and from the shop's storage, with its smaller copies.
      </ConfirmDialog>
    </Card>
  );
};
