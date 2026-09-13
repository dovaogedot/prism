/**
 * Pixel work on RGBA images held in memory, as pure functions: where the
 * content of a picture is, and how one picture is drawn on another.
 */

/** An RGBA image: `data` holds `width * height` pixels of four bytes each, row after row. */
export type Raw = Readonly<{ data: Buffer; width: number; height: number }>;

/** A color with each channel from 0 to 1. */
export type Rgba = Readonly<{ r: number; g: number; b: number; a: number }>;

/** A rectangle inside an image, in pixels. */
export type Box = Readonly<{ left: number; top: number; width: number; height: number }>;

/** A position inside a picture, as fractions of its width and height. */
export type Uv = Readonly<{ x: number; y: number }>;

/** The color a pixel takes, from where it is in the picture and the color it has. */
export type Shader = (uv: Uv, color: Rgba) => Rgba;

const at = (raw: Raw, x: number, y: number): number => (y * raw.width + x) * 4;

/** A channel as a byte, clipped to the range. */
const byte = (channel: number): number => Math.round(Math.min(1, Math.max(0, channel)) * 255);

const write = (data: Buffer, offset: number, color: Rgba): void => {
  data[offset] = byte(color.r);
  data[offset + 1] = byte(color.g);
  data[offset + 2] = byte(color.b);
  data[offset + 3] = byte(color.a);
};

export const Raster = {
  /** Alpha, as a byte, from which a pixel counts as content. The faint halo some sources leave around a sprite falls below it. */
  SOLID: 128,

  /** The color at (`x`, `y`). */
  pixel: (raw: Raw, x: number, y: number): Rgba => {
    const offset = at(raw, x, y);
    return {
      r: (raw.data[offset] ?? 0) / 255,
      g: (raw.data[offset + 1] ?? 0) / 255,
      b: (raw.data[offset + 2] ?? 0) / 255,
      a: (raw.data[offset + 3] ?? 0) / 255,
    };
  },

  /** Whether the pixel at (`x`, `y`) counts as content. */
  solid: (raw: Raw, x: number, y: number): boolean => (raw.data[at(raw, x, y) + 3] ?? 0) >= Raster.SOLID,

  /** The smallest box around the content; the whole image when it has none. */
  bounds: (raw: Raw): Box => {
    let left = raw.width;
    let top = raw.height;
    let right = 0;
    let bottom = 0;

    for (let y = 0; y < raw.height; y += 1) {
      for (let x = 0; x < raw.width; x += 1) {
        if (!Raster.solid(raw, x, y)) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x + 1);
        bottom = Math.max(bottom, y + 1);
      }
    }

    return right <= left ? { left: 0, top: 0, width: raw.width, height: raw.height } : { left, top, width: right - left, height: bottom - top };
  },

  /** The fewest pixels between the content and any edge. */
  margin: (raw: Raw): number => {
    const box = Raster.bounds(raw);
    return Math.min(box.left, box.top, raw.width - box.left - box.width, raw.height - box.top - box.height);
  },

  /** The part of `raw` inside `box`. */
  cropped: (raw: Raw, box: Box): Raw => {
    const data = Buffer.alloc(box.width * box.height * 4);
    for (let y = 0; y < box.height; y += 1) {
      const from = at(raw, box.left, box.top + y);
      raw.data.copy(data, y * box.width * 4, from, from + box.width * 4);
    }
    return { data, width: box.width, height: box.height };
  },

  /**
   * `face` with `card` centered on it. A pixel of the card is drawn when
   * `ink` accepts it, and so is any pixel enclosed by such pixels; the face
   * shows through every pixel that reaches the card's edge without them.
   */
  faced: (face: Raw, card: Raw, ink: (color: Rgba) => boolean): Raw => {
    const outside = new Uint8Array(card.width * card.height);
    const pending: number[] = [];
    const reach = (x: number, y: number): void => {
      const index = y * card.width + x;
      if (outside[index] === 1 || ink(Raster.pixel(card, x, y))) return;
      outside[index] = 1;
      pending.push(index);
    };

    for (let x = 0; x < card.width; x += 1) {
      reach(x, 0);
      reach(x, card.height - 1);
    }
    for (let y = 0; y < card.height; y += 1) {
      reach(0, y);
      reach(card.width - 1, y);
    }
    for (let index = pending.pop(); index !== undefined; index = pending.pop()) {
      const x = index % card.width;
      const y = (index - x) / card.width;
      if (x > 0) reach(x - 1, y);
      if (x < card.width - 1) reach(x + 1, y);
      if (y > 0) reach(x, y - 1);
      if (y < card.height - 1) reach(x, y + 1);
    }

    const data = Buffer.from(face.data);
    const left = Math.floor((face.width - card.width) / 2);
    const top = Math.floor((face.height - card.height) / 2);
    for (let y = 0; y < card.height; y += 1) {
      for (let x = 0; x < card.width; x += 1) {
        const onFace = left + x >= 0 && left + x < face.width && top + y >= 0 && top + y < face.height;
        if (outside[y * card.width + x] === 1 || !onFace) continue;
        write(data, at(face, left + x, top + y), Raster.pixel(card, x, y));
      }
    }

    return { data, width: face.width, height: face.height };
  },

  /** Every pixel of `raw` recolored by `shade`, given the pixel's center as fractions of the picture. */
  shaded: (raw: Raw, shade: Shader): Raw => {
    const data = Buffer.alloc(raw.data.length);
    for (let y = 0; y < raw.height; y += 1) {
      for (let x = 0; x < raw.width; x += 1) {
        write(data, at(raw, x, y), shade({ x: (x + 0.5) / raw.width, y: (y + 0.5) / raw.height }, Raster.pixel(raw, x, y)));
      }
    }
    return { data, width: raw.width, height: raw.height };
  },
} as const;
