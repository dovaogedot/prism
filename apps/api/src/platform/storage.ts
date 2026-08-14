/**
 * Product image storage on a Docker volume.
 *
 * Two rules make this safe. First, the file type is decided by reading the
 * magic bytes, not by trusting the upload's filename or Content-Type — a PHP
 * script renamed to `swatch.png` and declared `image/png` is still rejected.
 * Second, the stored filename is the SHA-256 of the bytes, so nothing an
 * uploader controls ever reaches the filesystem: no `../`, no null bytes, no
 * collisions, and identical uploads deduplicate for free.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DomainError } from "@hue/shared";
import { Option } from "@hue/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";

export const IMAGE_TYPES = ["png", "jpg", "webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const CONTENT_TYPE_BY_IMAGE_TYPE: Record<ImageType, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

const startsWith = (bytes: Uint8Array, signature: readonly number[]): boolean =>
  signature.length <= bytes.length &&
  signature.every((byte, index) => bytes[index] === byte);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

/**
 * Identifies an image by its content. A pure function over bytes, so the
 * security tests can throw disguised payloads at it without touching a disk.
 */
export const detectImageType = (bytes: Uint8Array): Option<ImageType> => {
  if (startsWith(bytes, PNG_SIGNATURE)) return Option.some("png");
  if (startsWith(bytes, JPEG_SIGNATURE)) return Option.some("jpg");

  if (
    startsWith(bytes, RIFF_SIGNATURE) &&
    bytes.length >= 12 &&
    WEBP_TAG.every((byte, index) => bytes[8 + index] === byte)
  ) {
    return Option.some("webp");
  }

  return Option.none;
};

export type StoredImage = Readonly<{
  filename: string;
  byteLength: number;
  contentType: string;
}>;

export type MediaStorage = Readonly<{
  save: (bytes: Uint8Array) => ResultAsync<StoredImage, DomainError>;
  /** Absolute path for the static file handler, or None if the name is not ours. */
  resolve: (filename: string) => Option<string>;
  directory: string;
}>;

export type StorageOptions = Readonly<{
  directory: string;
  maxBytes: number;
}>;

/** Exactly the shape `save` produces: 64 hex characters and a known extension. */
const STORED_FILENAME_PATTERN = /^[a-f0-9]{64}\.(png|jpg|webp)$/;

export const createFileMediaStorage = (options: StorageOptions): MediaStorage => ({
  directory: options.directory,

  save: (bytes) => {
    if (bytes.byteLength > options.maxBytes) {
      return errAsync<StoredImage, DomainError>({ _tag: "ImageTooLarge" });
    }

    const detected = detectImageType(bytes);

    if (Option.isNone(detected)) {
      return errAsync<StoredImage, DomainError>({ _tag: "ImageTypeUnsupported" });
    }

    const imageType = detected.value;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const filename = `${digest}.${imageType}`;

    return ResultAsync.fromPromise(
      mkdir(options.directory, { recursive: true })
        .then(() => writeFile(join(options.directory, filename), bytes))
        .then(
          (): StoredImage => ({
            filename,
            byteLength: bytes.byteLength,
            contentType: CONTENT_TYPE_BY_IMAGE_TYPE[imageType],
          }),
        ),
      (): DomainError => ({ _tag: "ImageTypeUnsupported" }),
    );
  },

  // Path traversal cannot survive this: the name must match the pattern that
  // only `save` produces, so `../` never reaches `join`.
  resolve: (filename) =>
    STORED_FILENAME_PATTERN.test(filename)
      ? Option.some(join(options.directory, filename))
      : Option.none,
});
