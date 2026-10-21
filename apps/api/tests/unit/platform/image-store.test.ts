import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ImageId } from "@prism/shared";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImageStore } from "../../../src/platform/image-store.ts";

describe("ImageStore.variantWidths", () => {
  it("makes every standard width up to the source's, and never a wider one", () => {
    expect(ImageStore.variantWidths(216)).toEqual([160]);
    expect(ImageStore.variantWidths(576)).toEqual([160, 400]);
    expect(ImageStore.variantWidths(864)).toEqual([160, 400, 800]);
    expect(ImageStore.variantWidths(2400)).toEqual([160, 400, 800, 1600]);
  });

  it("makes one copy at the source's own width when it is narrower than every standard width", () => {
    expect(ImageStore.variantWidths(120)).toEqual([120]);
  });
});

describe("ImageStore.save", () => {
  const picture = () => sharp({ create: { width: 4, height: 4, channels: 3, background: "#336699" } }).png().toBuffer();

  it("refuses bytes that are no picture as an unsupported image", async () => {
    const result = await ImageStore.create(tmpdir()).save(Buffer.from("not a picture"));

    expect(result._unsafeUnwrapErr()).toEqual({ _tag: "UnsupportedImage" });
  });

  it("rejects, rather than blaming the upload, when the picture cannot be written", async () => {
    const store = ImageStore.create(join(tmpdir(), "prism-no-such-directory", "media"));

    await expect(store.save(await picture())).rejects.toThrow(/ENOENT/);
  });
});

describe("ImageStore.makeVariants", () => {
  let directory: string;

  /** A two-color checkerboard of 8-pixel squares, `size` pixels a side, as a PNG. */
  const checkerboard = (size: number): Promise<Buffer> => {
    const pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const isDark = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
        pixels.fill(isDark ? 20 : 235, (y * size + x) * 3, (y * size + x) * 3 + 3);
      }
    }
    return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).png().toBuffer();
  };

  /** How many distinct colors a WebP file holds. */
  const colorsOf = async (file: string): Promise<number> => {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    const colors = new Set<string>();
    for (let offset = 0; offset < data.length; offset += info.channels) {
      colors.add(data.subarray(offset, offset + 3).toString("hex"));
    }
    return colors.size;
  };

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "prism-variants-"));
    await writeFile(join(directory, "board.png"), await checkerboard(216));
  });

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("keeps a two-color pixel-art source at two colors when it shrinks it", async () => {
    const id = ImageId.schema.parse("00000000-0000-4000-8000-000000000001");
    const size = await ImageStore.create(directory).makeVariants({ id, file: "board.png", isPixelArt: true });

    expect(size).toEqual({ width: 216, height: 216 });
    expect(await colorsOf(join(directory, "variants", id, "160.webp"))).toBe(2);
  });

  it("blends the same source into many colors when it is not pixel art", async () => {
    const id = ImageId.schema.parse("00000000-0000-4000-8000-000000000002");
    await ImageStore.create(directory).makeVariants({ id, file: "board.png", isPixelArt: false });

    expect(await colorsOf(join(directory, "variants", id, "160.webp"))).toBeGreaterThan(2);
  });
});
