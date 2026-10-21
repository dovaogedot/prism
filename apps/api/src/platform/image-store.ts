/**
 * Product pictures on disk. An upload is decoded and encoded again before it
 * is stored, which drops its metadata, GPS position included, and refuses
 * anything that is not a JPEG, PNG or WebP picture. Each stored picture gets
 * smaller WebP copies for `srcset`, at
 * `<media>/variants/<image id>/<width>.webp`; the source stays for the
 * full-size view.
 */

import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageId, type DomainError } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import sharp, { type OutputInfo, type Sharp } from "sharp";

/** A picture as stored: its id, its file under the media directory, and its size in pixels. */
export type StoredImage = Readonly<{ id: ImageId; file: string; width: number; height: number }>;

/** An upload decoded and encoded again, before it is written. */
type Encoded = Readonly<{ format: (typeof ImageStore.FORMATS)[number]; data: Buffer; info: OutputInfo }>;

/** What making variants needs to know about a stored picture. */
export type VariantSource = Readonly<{ id: ImageId; file: string; isPixelArt: boolean }>;

/** Storing, copying at smaller sizes, and deleting product pictures. */
export type ImageStore = Readonly<{
  /**
   * Checks, decodes and re-encodes an upload, and stores it under a random
   * name. Refuses anything but a JPEG, PNG or WebP picture with
   * `UnsupportedImage`, and one over the pixel limit with `PayloadTooLarge`.
   * Rejects when the picture cannot be written, which is the server's fault
   * rather than the upload's.
   */
  save: (bytes: Buffer) => ResultAsync<StoredImage, DomainError>;
  /**
   * Writes the WebP variants of a stored picture, each under a temporary name
   * first and renamed into place, so a reader never sees half a file.
   * Resolves to the source's size. Rejects when the source cannot be read.
   */
  makeVariants: (image: VariantSource) => Promise<Readonly<{ width: number; height: number }>>;
  /** Deletes the picture and its variants. A file already gone is no failure. */
  remove: (image: Readonly<{ id: ImageId; file: string }>) => Promise<void>;
}>;

export const ImageStore = {
  /** The widths variants are made at, never wider than the source. */
  WIDTHS: [160, 400, 800, 1600] as const,
  /** The largest picture accepted, in pixels: enough for any photo, too few for a decompression bomb. */
  MAX_PIXELS: 40_000_000,
  /** WebP quality for photographs' variants; drawings and pixel art are stored lossless. */
  QUALITY: 82,
  FORMATS: ["jpeg", "png", "webp"] as const,

  /**
   * The widths a source `width` pixels wide gets variants at: every standard
   * width up to the source's own, or the source's own width when it is
   * narrower than all of them, so every picture has at least one.
   */
  variantWidths: (width: number): readonly number[] => {
    const fitting = ImageStore.WIDTHS.filter((candidate) => candidate <= width);
    return fitting.length === 0 ? [width] : fitting;
  },

  /** Where a variant is served from. */
  variantUrl: (id: ImageId, width: number): string => `/media/variants/${id}/${width}.webp`,

  /** Where a source is served from. */
  sourceUrl: (file: string): string => `/media/${file}`,

  /** Whether a sharp failure is the pixel limit rather than a broken file. */
  isTooLarge: (reason: unknown): boolean =>
    reason instanceof Error && reason.message.toLowerCase().includes("pixel limit"),

  /** How each accepted format is encoded again on the way in. */
  encoders: {
    jpeg: (image: Sharp) => image.jpeg({ quality: 90, mozjpeg: true }),
    png: (image: Sharp) => image.png({ compressionLevel: 9 }),
    webp: (image: Sharp) => image.webp({ quality: 82 }),
  } as const satisfies Record<"jpeg" | "png" | "webp", (image: Sharp) => Sharp>,

  /** The file extension each accepted format is stored under. */
  extensions: { jpeg: "jpg", png: "png", webp: "webp" } as const satisfies Record<"jpeg" | "png" | "webp", string>,

  create: (directory: string): ImageStore => ({
    save: (bytes) =>
      ResultAsync.fromPromise(
        (async (): Promise<Encoded | undefined> => {
          const image = sharp(bytes, { limitInputPixels: ImageStore.MAX_PIXELS, failOn: "error" });
          const metadata = await image.metadata();
          const format = ImageStore.FORMATS.find((candidate) => candidate === metadata.format);
          if (format === undefined) return undefined;

          // Applies the orientation the metadata asked for before the metadata goes.
          const encoded = await ImageStore.encoders[format](image.rotate()).toBuffer({ resolveWithObject: true });
          return { format, ...encoded };
        })(),
        // A file sharp cannot decode is no picture at all.
        (reason): DomainError => (ImageStore.isTooLarge(reason) ? { _tag: "PayloadTooLarge" } : { _tag: "UnsupportedImage" }),
      )
        .andThen((encoded) =>
          encoded === undefined ? errAsync<Encoded, DomainError>({ _tag: "UnsupportedImage" }) : okAsync<Encoded, DomainError>(encoded),
        )
        .andThen(({ format, data, info }) =>
          // A write that fails is left to reject: the server's fault, logged and answered as one.
          ResultAsync.fromSafePromise(
            (async (): Promise<StoredImage> => {
              const id = ImageId.schema.parse(randomUUID());
              const file = `${id}.${ImageStore.extensions[format]}`;
              await writeFile(join(directory, file), data);

              return { id, file, width: info.width, height: info.height };
            })(),
          ),
        ),

    makeVariants: async ({ id, file, isPixelArt }) => {
      const source = join(directory, file);
      const metadata = await sharp(source, { limitInputPixels: ImageStore.MAX_PIXELS }).metadata();
      const width = metadata.autoOrient?.width ?? metadata.width;
      const height = metadata.autoOrient?.height ?? metadata.height;
      if (width === undefined || height === undefined) throw new Error(`${file} has no size.`);

      const folder = join(directory, "variants", id);
      await mkdir(folder, { recursive: true });

      // A drawing keeps every pixel exact; a photograph trades invisible detail for size.
      const isLossless = isPixelArt || metadata.format === "png";

      for (const target of ImageStore.variantWidths(width)) {
        const temporary = join(folder, `${target}.webp.${randomUUID()}.tmp`);

        await sharp(source, { limitInputPixels: ImageStore.MAX_PIXELS })
          .rotate()
          .resize({ width: target, kernel: isPixelArt ? "nearest" : "lanczos3", withoutEnlargement: true })
          .webp(isLossless ? { lossless: true, effort: 4 } : { quality: ImageStore.QUALITY, effort: 4 })
          .toFile(temporary);
        await rename(temporary, join(folder, `${target}.webp`));
      }

      return { width, height };
    },

    remove: async ({ id, file }) => {
      await rm(join(directory, file), { force: true });
      await rm(join(directory, "variants", id), { recursive: true, force: true });
    },
  }),
} as const;
