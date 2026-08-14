/**
 * A minimal PNG encoder, used to generate one swatch image per colour at seed
 * time.
 *
 * Writing the bytes here rather than committing 250 binaries keeps the
 * repository text-only, and it means the seed exercises the same storage port
 * an admin upload goes through — the mandatory image handling is real rather
 * than staged.
 *
 * Truecolour, 8 bits per channel, no alpha. That is the whole PNG feature set
 * a flat swatch needs.
 */

import { deflateSync } from "node:zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const buildCrcTable = (): Uint32Array => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
};

const CRC_TABLE = buildCrcTable();

export const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
};

/** Every PNG chunk is length, type, payload, CRC over type and payload. */
const chunk = (type: string, payload: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);

  const typeAndPayload = Buffer.concat([Buffer.from(type, "ascii"), payload]);

  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typeAndPayload), 0);

  return Buffer.concat([length, typeAndPayload, checksum]);
};

export type Rgb = Readonly<{ red: number; green: number; blue: number }>;

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

/**
 * Builds an image from a function of pixel position. Keeping the pixel source
 * a callback means the gradient logic stays separate from the encoding.
 */
export const encodePng = (
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => Rgb,
): Buffer => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type 2: truecolour
  header.writeUInt8(0, 10); // deflate
  header.writeUInt8(0, 11); // adaptive filtering
  header.writeUInt8(0, 12); // no interlace

  // Each scanline is prefixed with its filter byte; 0 means "store as-is".
  const raw = Buffer.alloc(height * (1 + width * 3));
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0;
    offset += 1;

    for (let x = 0; x < width; x += 1) {
      const pixel = pixelAt(x, y);
      raw[offset] = clampChannel(pixel.red);
      raw[offset + 1] = clampChannel(pixel.green);
      raw[offset + 2] = clampChannel(pixel.blue);
      offset += 3;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

export const hexToRgb = (hex: string): Rgb => ({
  red: Number.parseInt(hex.slice(1, 3), 16),
  green: Number.parseInt(hex.slice(3, 5), 16),
  blue: Number.parseInt(hex.slice(5, 7), 16),
});

const mix = (from: Rgb, to: Rgb, amount: number): Rgb => ({
  red: from.red + (to.red - from.red) * amount,
  green: from.green + (to.green - from.green) * amount,
  blue: from.blue + (to.blue - from.blue) * amount,
});

const WHITE: Rgb = { red: 255, green: 255, blue: 255 };
const BLACK: Rgb = { red: 0, green: 0, blue: 0 };

/**
 * A swatch: the colour itself, lit from the top-left and falling away toward
 * the bottom-right, so a grid of them reads as objects rather than as CSS
 * background rectangles.
 */
export const renderSwatch = (hex: string, size = 600): Buffer => {
  const base = hexToRgb(hex);
  const highlight = mix(base, WHITE, 0.18);
  const shadow = mix(base, BLACK, 0.22);

  return encodePng(size, size, (x, y) => {
    // Diagonal position, 0 at the top-left corner and 1 at the bottom-right.
    const along = (x / (size - 1) + y / (size - 1)) / 2;

    return along < 0.5
      ? mix(highlight, base, along * 2)
      : mix(base, shadow, (along - 0.5) * 2);
  });
};
