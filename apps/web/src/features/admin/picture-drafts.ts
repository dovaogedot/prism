import type { ProductImage } from "@prism/shared";

/** A picture as the list edits it: the picture and the text that describes it. */
export type PictureDraft = Readonly<{ image: ProductImage; alt: string }>;

/** The unsaved order and texts of a product's pictures. */
export const PictureDrafts = {
  /** Drafts of `images` as the server lists them. */
  of: (images: readonly ProductImage[]): readonly PictureDraft[] => images.map((image) => ({ image, alt: image.alt })),

  /**
   * The drafts once the server's list moves from `before` to `after`, as an
   * upload or a delete does: each picture still there keeps its place among
   * the others and any text typed for it, and a new picture goes last.
   */
  merge: (drafts: readonly PictureDraft[], before: readonly ProductImage[], after: readonly ProductImage[]): readonly PictureDraft[] => {
    const current = new Map(after.map((image) => [image.id, image]));
    const saved = new Map(before.map((image) => [image.id, image.alt]));
    const kept = drafts.flatMap((draft) => {
      const image = current.get(draft.image.id);
      if (image === undefined) return [];

      // A text nobody edited follows the server's.
      return [{ image, alt: draft.alt === saved.get(image.id) ? image.alt : draft.alt }];
    });
    const known = new Set(drafts.map((draft) => draft.image.id));

    return [...kept, ...after.filter((image) => !known.has(image.id)).map((image) => ({ image, alt: image.alt }))];
  },
} as const;
