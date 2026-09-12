/**
 * Reading what the stages on a page have drawn.
 *
 * A stage is a 2D canvas the one WebGL context blits onto, so what a spec can
 * see of it is pixels rather than markup: whether anything has been drawn, how
 * bright the room behind the subject is, and whether two moments look the
 * same. Shared by every spec that checks a picture — outside `specs/` on
 * purpose, because Playwright refuses to let one test file import another.
 *
 * Everything here reads a live browser. Nothing here decides what is correct;
 * the ceilings a reading is held to belong to the spec that holds it.
 */

import { expect, type Page } from "@playwright/test";

/** The parameter the software-renderer decision in `gl.ts` reads. */
const UNMASKED_RENDERER_WEBGL = 0x9246;

/** Long, because every stage is drawn in software here. */
export const DRAWN = { timeout: 60_000 };

/**
 * Answer as though this browser had a real GPU.
 *
 * Live rendering starts where the machine is, and a headless browser is a
 * software rasterizer — so without this the page shows stills and a check on
 * a stage would pass by finding nothing.
 */
export const pretendGpu = async (page: Page): Promise<void> => {
  await page.addInitScript((parameter: number) => {
    const real = WebGL2RenderingContext.prototype.getParameter;

    WebGL2RenderingContext.prototype.getParameter = function (
      this: WebGL2RenderingContext,
      name: number,
    ): unknown {
      return name === parameter ? "Prism Test GPU" : real.call(this, name);
    };
  }, UNMASKED_RENDERER_WEBGL);
};

/**
 * Answer as though this browser had no WebGL2 at all.
 *
 * The one machine the switch is not offered on, because nothing it could
 * choose would be drawn.
 */
export const refuseWebGl2 = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;

    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, kind: string) {
        return kind === "webgl2" ? null : real.call(this, kind);
      },
    });
  });
};

/** How many stages the page is holding, drawn or not. */
export const stages = (page: Page): Promise<number> =>
  page.evaluate(
    () => document.querySelectorAll("canvas.stage__canvas").length,
  );

/**
 * How many stages have had something drawn on them.
 *
 * A stage is transparent until its turn comes, and its turn comes late here
 * because a headless browser draws them one at a time. Counting them is what
 * makes the wait a condition rather than a guess at how long the machine
 * takes.
 */
export const painted = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      [
        ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
      ].filter((canvas) => {
        const context = canvas.getContext("2d");
        if (context === null || canvas.width === 0) return false;

        const middle = context.getImageData(
          Math.floor(canvas.width / 2),
          Math.floor(canvas.height / 2),
          1,
          1,
        ).data;

        return (middle[3] ?? 0) > 0;
      }).length,
  );

/**
 * Waits until every stage on the page has drawn, and says how many that was.
 *
 * Two waits, because a page arrives in two steps: the cards are mounted, and
 * then the one renderer works through their canvases one at a time. Counting
 * before the first step would count nothing and pass.
 */
export const drawn = async (page: Page): Promise<number> => {
  await expect.poll(() => stages(page), DRAWN).toBeGreaterThan(0);

  const held = await stages(page);

  await expect.poll(() => painted(page), DRAWN).toBe(held);

  return held;
};

/** A background reading of one stage, in percent. */
export type Background = Readonly<{
  /** The lightest pixel, in HSL lightness. */
  peakLightness: number;
  /**
   * How far apart the strongest and weakest channels of the average color
   * are: how much color the background carries, whatever its lightness.
   *
   * Not HSL saturation, which divides by how far the lightness is from the
   * ends of the scale, so a background a level or two off gray reads as
   * strongly saturated once it is near white.
   */
  chroma: number;
}>;

/**
 * The background of every stage on the page.
 *
 * Everything outside the middle three fifths, which is where the subject is —
 * so the reading is the room and the spill against it, never the face.
 */
export const backgrounds = (page: Page): Promise<readonly Background[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return { peakLightness: 0, chroma: 0 };

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const channel = (index: number): number => pixels[index] ?? 0;
      const near = canvas.width * 0.2;
      const far = canvas.width * 0.8;
      let peak = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      let counted = 0;

      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          if (x > near && x < far && y > near && y < far) continue;

          const at = (y * canvas.width + x) * 4;
          const [r, g, b] = [channel(at), channel(at + 1), channel(at + 2)];

          peak = Math.max(peak, (Math.max(r, g, b) + Math.min(r, g, b)) / 2);
          red += r;
          green += g;
          blue += b;
          counted += 1;
        }
      }

      const highest = Math.max(red, green, blue) / counted / 255;
      const lowest = Math.min(red, green, blue) / counted / 255;

      return {
        peakLightness: (peak / 255) * 100,
        chroma: (highest - lowest) * 100,
      };
    }),
  );

/**
 * The brightest thing in each stage's four corners, in percent lightness.
 *
 * A room stands three subjects across its width, so the ring `backgrounds`
 * reads has subjects in it and answers how bright they are rather than how
 * bright the room is. The corners are the part of a stage nothing stands in,
 * which leaves only what has spilled there.
 */
export const corners = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const across = Math.floor(canvas.width * 0.2);
      const down = Math.floor(canvas.height * 0.2);
      let peak = 0;

      for (let y = 0; y < canvas.height; y += 2) {
        if (y >= down && y <= canvas.height - down) continue;

        for (let x = 0; x < canvas.width; x += 2) {
          if (x >= across && x <= canvas.width - across) continue;

          const at = (y * canvas.width + x) * 4;
          const [red, green, blue] = [
            pixels[at] ?? 0,
            pixels[at + 1] ?? 0,
            pixels[at + 2] ?? 0,
          ];

          peak = Math.max(
            peak,
            (Math.max(red, green, blue) + Math.min(red, green, blue)) / 2,
          );
        }
      }

      return (peak / 255) * 100;
    }),
  );

/**
 * How much light is in the outer fifth of each stage, in percent lightness.
 *
 * The mean rather than a peak, and over the whole ring rather than the corners
 * alone, because what it is reading is the spill: light that left the subjects
 * and is in the air around them. A peak answers with the brightest single
 * pixel that reached the ring, which one highlight can carry; the mean answers
 * how much of the ring the spill has filled.
 */
export const outerRings = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const across = Math.floor(canvas.width * 0.2);
      const down = Math.floor(canvas.height * 0.2);
      let total = 0;
      let counted = 0;

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const inside =
            y >= down && y <= canvas.height - down && x >= across && x <= canvas.width - across;
          if (inside) continue;

          const at = (y * canvas.width + x) * 4;
          // Rec. 709, which is what "how bright does this look" means for a
          // spill that is a different hue on every subject.
          total +=
            0.2126 * (pixels[at] ?? 0) +
            0.7152 * (pixels[at + 1] ?? 0) +
            0.0722 * (pixels[at + 2] ?? 0);
          counted += 1;
        }
      }

      return counted === 0 ? 0 : (total / counted / 255) * 100;
    }),
  );

/** How light the page behind the stages is, in percent HSL lightness. */
export const pageLightness = (page: Page): Promise<number> =>
  page.evaluate(() => {
    // Painted and read back, so the page is compared in the same bytes as a
    // stage's pixels whatever color space its style is written in.
    const probe = document.createElement("canvas");
    probe.width = 1;
    probe.height = 1;

    const context = probe.getContext("2d");
    if (context === null) return 0;

    context.fillStyle = getComputedStyle(document.body).backgroundColor;
    context.fillRect(0, 0, 1, 1);

    const pixel = context.getImageData(0, 0, 1, 1).data;
    const [red, green, blue] = [pixel[0] ?? 0, pixel[1] ?? 0, pixel[2] ?? 0];

    return ((Math.max(red, green, blue) + Math.min(red, green, blue)) / 2 / 255) * 100;
  });

/**
 * How light the top of each stage is, in percent HSL lightness.
 *
 * The lightness of the mean color of the top sixth or so of the stage. That
 * is the far wall in every room: nothing stands in it and no floor reaches it,
 * so it is the background the stage shows against the page around it.
 */
export const topBands = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;

      const band = Math.round(canvas.height * 0.15);
      const pixels = context.getImageData(0, 0, canvas.width, band).data;
      let red = 0;
      let green = 0;
      let blue = 0;
      let counted = 0;

      for (let at = 0; at < pixels.length; at += 4) {
        red += pixels[at] ?? 0;
        green += pixels[at + 1] ?? 0;
        blue += pixels[at + 2] ?? 0;
        counted += 1;
      }

      if (counted === 0) return 0;

      const highest = Math.max(red, green, blue) / counted;
      const lowest = Math.min(red, green, blue) / counted;

      return ((highest + lowest) / 2 / 255) * 100;
    }),
  );

/**
 * How strong the most colored part of each stage is, in percent.
 *
 * A pixel's color is how far apart its strongest and weakest channels are, and
 * the reading is the least of it in the most colored fiftieth of the stage. A
 * face that glows carries its pigment at full strength; the same face under a
 * spill laid over it, or in a room whose own light covers the pigment, fades
 * toward white and reads as a soft copy of itself rather than as a light.
 */
export const peakChromas = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const counts = new Array<number>(256).fill(0);
      let counted = 0;

      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          const at = (y * canvas.width + x) * 4;
          const [red, green, blue] = [
            pixels[at] ?? 0,
            pixels[at + 1] ?? 0,
            pixels[at + 2] ?? 0,
          ];
          const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);

          counts[chroma] = (counts[chroma] ?? 0) + 1;
          counted += 1;
        }
      }

      let below = 0;
      const chroma = counts.findIndex((count) => {
        below += count;
        return below >= counted * 0.98;
      });

      return (Math.max(0, chroma) / 255) * 100;
    }),
  );

/**
 * How light the darkest tenth of each stage is, in percent lightness.
 *
 * That tenth is the part of the room no lamp and no glow reaches, so what
 * lights it is only the light that arrives from everywhere at once. A peak or
 * a mean would answer with the lamps and the spill instead, which cover the
 * rest of the stage.
 */
export const darkestTenths = (page: Page): Promise<readonly number[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return 0;

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // Indexed by the brightest channel plus the dimmest, which is twice the
      // lightness in 8-bit steps and keeps its half steps whole.
      const counts = new Array<number>(511).fill(0);
      let counted = 0;

      for (let y = 0; y < canvas.height; y += 2) {
        for (let x = 0; x < canvas.width; x += 2) {
          const at = (y * canvas.width + x) * 4;
          const [red, green, blue] = [
            pixels[at] ?? 0,
            pixels[at + 1] ?? 0,
            pixels[at + 2] ?? 0,
          ];
          const doubled = Math.max(red, green, blue) + Math.min(red, green, blue);

          counts[doubled] = (counts[doubled] ?? 0) + 1;
          counted += 1;
        }
      }

      let below = 0;
      const doubled = counts.findIndex((count) => {
        below += count;
        return below >= counted / 10;
      });

      return (Math.max(0, doubled) / 2 / 255) * 100;
    }),
  );

/** Where the colored part of one stage is, in fractions of its own edges. */
export type ColorBox = Readonly<{
  /** The left edge of it, 0 being the left of the stage. */
  left: number;
  /** The right edge of it, 1 being the right of the stage. */
  right: number;
  /** The top edge of it, 0 being the top of the stage. */
  top: number;
  /** The bottom edge of it, 1 being the bottom of the stage. */
  bottom: number;
}>;

/**
 * The box the colored pixels of every stage on the page fit inside.
 *
 * Colored is by how far apart a pixel's strongest and weakest channels are, in
 * absolute terms rather than as a share of how light it is: the lamps in these
 * rooms are warm and the floor under them is bright, and a share would call
 * that floor colored. A stage with nothing colored on it answers a box with
 * its left past its right, which fails every reading that can be taken of one.
 */
export const colorBoxes = (page: Page): Promise<readonly ColorBox[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const empty = { left: 1, right: 0, top: 1, bottom: 0 };
      const context = canvas.getContext("2d");
      if (context === null || canvas.width === 0) return empty;

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const box = { left: canvas.width, right: -1, top: canvas.height, bottom: -1 };

      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const at = (y * canvas.width + x) * 4;
          if ((pixels[at + 3] ?? 0) === 0) continue;

          const red = (pixels[at] ?? 0) / 255;
          const green = (pixels[at + 1] ?? 0) / 255;
          const blue = (pixels[at + 2] ?? 0) / 255;

          if (Math.max(red, green, blue) - Math.min(red, green, blue) < 0.12) continue;

          box.left = Math.min(box.left, x);
          box.right = Math.max(box.right, x);
          box.top = Math.min(box.top, y);
          box.bottom = Math.max(box.bottom, y);
        }
      }

      return box.right < 0
        ? empty
        : {
            left: box.left / canvas.width,
            right: box.right / canvas.width,
            top: box.top / canvas.height,
            bottom: box.bottom / canvas.height,
          };
    }),
  );

/** How the colors on one stage are spread around the hue wheel. */
export type HueSpread = Readonly<{
  /** How many of the wheel's thirty-six steps hold colored pixels of their own. */
  steps: number;
  /** The share of colored pixels in the busiest step, as a percentage. */
  peak: number;
}>;

/**
 * How the colors on every stage are spread around the hue wheel.
 *
 * The wheel in thirty-six steps, counting the steps that hold at least a two
 * hundredth of the colored pixels. A pigment on its own is one hue lit at many
 * strengths and lands in two or three steps; a coating adds the colors of the
 * reflection it splits, and those are spread over the whole wheel. The peak is
 * the other end of the same reading: how much of the picture is still the hue
 * the subject was painted. Anything too gray to have a hue is left out, which
 * is the room and most of the subject's shaded side.
 */
export const hueSpread = (page: Page): Promise<readonly HueSpread[]> =>
  page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLCanvasElement>("canvas.stage__canvas"),
    ].map((canvas) => {
      const context = canvas.getContext("2d");
      if (context === null) return { steps: 0, peak: 0 };

      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const steps = new Array<number>(36).fill(0);
      let colored = 0;

      for (let at = 0; at < pixels.length; at += 4) {
        if ((pixels[at + 3] ?? 0) === 0) continue;

        const red = (pixels[at] ?? 0) / 255;
        const green = (pixels[at + 1] ?? 0) / 255;
        const blue = (pixels[at + 2] ?? 0) / 255;
        const highest = Math.max(red, green, blue);
        const lowest = Math.min(red, green, blue);
        const range = highest - lowest;

        if (range === 0) continue;

        const lightness = (highest + lowest) / 2;
        if (range / (1 - Math.abs(2 * lightness - 1)) < 0.15) continue;

        const sixth =
          highest === red
            ? (green - blue) / range
            : highest === green
              ? (blue - red) / range + 2
              : (red - green) / range + 4;
        const hue = (((sixth * 60) % 360) + 360) % 360;

        steps[Math.floor(hue / 10)] = (steps[Math.floor(hue / 10)] ?? 0) + 1;
        colored += 1;
      }

      return {
        steps: steps.filter((held) => held >= colored * 0.005).length,
        peak: colored === 0 ? 0 : (Math.max(...steps) / colored) * 100,
      };
    }),
  );

/**
 * A digest of what the first stage on the page is showing.
 *
 * A grid of 144 samples rather than every pixel: dense enough that a change
 * confined to the subjects lands on some of them — turning a coating shifts
 * about a twentieth of the frame and misses a coarser grid entirely — and
 * cheap enough to take between frames. The samples are folded down because
 * what a caller asks of this is whether two moments differ, and a hundred
 * numbers answer that no better than eight characters do. An empty string is
 * a stage with nothing on it.
 */
export const signature = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      "canvas.stage__canvas",
    );
    const context = canvas === null ? null : canvas.getContext("2d");

    if (canvas === null || context === null || canvas.width === 0) return "";

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const side = 12;
    let digest = 0x811c9dc5;

    const fold = (byte: number): void => {
      digest = Math.imul(digest ^ byte, 0x01000193) >>> 0;
    };

    for (let row = 1; row <= side; row += 1) {
      for (let column = 1; column <= side; column += 1) {
        const x = Math.floor((canvas.width * column) / (side + 1));
        const y = Math.floor((canvas.height * row) / (side + 1));
        const at = (y * canvas.width + x) * 4;

        fold(pixels[at] ?? 0);
        fold(pixels[at + 1] ?? 0);
        fold(pixels[at + 2] ?? 0);
      }
    }

    return digest.toString(16).padStart(8, "0");
  });

/** What the floor and the two walls of a corner are carrying. */
export type Surfaces = Readonly<{
  /**
   * How much of the floor lies where two shadows overlap, as a percentage of
   * the floor. One lamp cannot lay a shadow inside its own shadow, so under a
   * single lamp this is nothing, however large or dark that lamp's shadow is.
   */
  overlap: number;
  /**
   * How many times as bright the brightest part of each wall is as its
   * dimmest: the side wall, which is the left half of the picture, and the
   * back wall, which is the right half.
   */
  walls: Readonly<{ left: number; right: number }>;
}>;

/**
 * Where each column of a stage's picture stops being floor and starts being
 * wall, as the row the floor last reached, with the size of the picture it
 * was found in.
 */
export type Seams = Readonly<{ width: number; height: number; rows: readonly number[] }>;

/**
 * Where the walls of the first stage on the page meet its floor.
 *
 * The floor runs up each column from the bottom until a wall far darker than
 * it begins. A room is the same room seen from the same place under both
 * themes, so the seams found under the dark one, where every wall is that much
 * darker, are the seams under the light one too, where a wall can be nearly
 * as light as the floor. A stage with nothing drawn on it has no seams.
 */
export const seamsOf = (page: Page): Promise<Seams> =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stage__canvas");
    const context = canvas?.getContext("2d") ?? null;

    if (canvas === null || context === null || canvas.width === 0) {
      return { width: 0, height: 0, rows: [] };
    }

    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const read = (values: ArrayLike<number>, at: number): number => values[at] ?? 0;
    const channel = (at: number, offset: number): number => read(pixels, at * 4 + offset);
    const saturation = (at: number): number => {
      const most = Math.max(channel(at, 0), channel(at, 1), channel(at, 2));
      const least = Math.min(channel(at, 0), channel(at, 1), channel(at, 2));

      return most === 0 ? 0 : (most - least) / most;
    };
    const lightnesses = Float32Array.from(
      { length: width * height },
      (_, at) => 0.2126 * channel(at, 0) + 0.7152 * channel(at, 1) + 0.0722 * channel(at, 2),
    );
    const lightness = (at: number): number => read(lightnesses, at);

    // Up each column from the bottom. A colored pixel is a subject; one under
    // half the brightest floor below it is a wall past the seam, or the dark
    // side of a subject; a sudden rise well over that is the lit side of one.
    // Everything else is floor, shadows included.
    const floor = new Uint8Array(width * height);

    for (let x = 0; x < width; x += 1) {
      let brightest = lightness((height - 1) * width + x);

      for (let y = height - 1; y >= 0; y -= 1) {
        const at = y * width + x;
        const here = lightness(at);
        const rise = y + 3 < height ? here - lightness(at + 3 * width) : 0;

        if (saturation(at) > 0.16 || here < brightest * 0.5) break;
        if (here > brightest * 1.35 && rise > 14) break;
        brightest = Math.max(brightest, here);
        floor[at] = 1;
      }
    }

    const rows = Array.from({ length: width }, (_, x) => {
      let seam = height - 1;

      while (seam > 0 && floor[seam * width + x] === 1) seam -= 1;

      return seam;
    });

    return { width, height, rows };
  });

/**
 * What the floor and the walls of the first stage on the page are carrying.
 *
 * The floor is what lies below the seam where a wall begins, less whatever
 * stands on it. Each wall is the outer part of its half of the picture, from
 * near the top down to the seam `seams` gives for that column, less anything
 * colored: nothing stands that far out but in color. Seams found in a stage of
 * another size are no seams. A stage with nothing drawn on it, or no seams,
 * answers no overlap and two walls with nothing on them.
 */
export const surfacesOf = (page: Page, seams: Seams): Promise<Surfaces> =>
  page.evaluate((found) => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas.stage__canvas");
    const context = canvas?.getContext("2d") ?? null;

    if (
      canvas === null ||
      context === null ||
      canvas.width === 0 ||
      canvas.width !== found.width ||
      canvas.height !== found.height
    ) {
      return { overlap: 0, walls: { left: 0, right: 0 } };
    }

    const { width, height } = canvas;
    const pixels = context.getImageData(0, 0, width, height).data;
    const read = (values: ArrayLike<number>, at: number): number => values[at] ?? 0;
    const channel = (at: number, offset: number): number => read(pixels, at * 4 + offset);
    const saturation = (at: number): number => {
      const most = Math.max(channel(at, 0), channel(at, 1), channel(at, 2));
      const least = Math.min(channel(at, 0), channel(at, 1), channel(at, 2));

      return most === 0 ? 0 : (most - least) / most;
    };
    const lightnesses = Float32Array.from(
      { length: width * height },
      (_, at) => 0.2126 * channel(at, 0) + 0.7152 * channel(at, 1) + 0.0722 * channel(at, 2),
    );
    const lightness = (at: number): number => read(lightnesses, at);

    // Up each column from the bottom. A colored pixel is a subject; one under
    // half the brightest floor below it is a wall past the seam, or the dark
    // side of a subject; a sudden rise well over that is the lit side of one.
    // Everything else is floor, shadows included.
    const floor = new Uint8Array(width * height);
    const floorTop = new Int32Array(width).fill(height);

    for (let x = 0; x < width; x += 1) {
      let brightest = lightness((height - 1) * width + x);

      for (let y = height - 1; y >= 0; y -= 1) {
        const at = y * width + x;
        const here = lightness(at);
        const rise = y + 3 < height ? here - lightness(at + 3 * width) : 0;

        if (saturation(at) > 0.16 || here < brightest * 0.5) break;
        if (here > brightest * 1.35 && rise > 14) break;
        brightest = Math.max(brightest, here);
        floor[at] = 1;
        floorTop[x] = y;
      }
    }

    // A thin band under the top of the floor in each column is left out: it
    // is the crease where the floor turns into a wall.
    const usable = new Uint8Array(floor.length);
    let area = 0;

    for (let at = 0; at < floor.length; at += 1) {
      if (floor[at] !== 1) continue;

      area += 1;
      if (Math.floor(at / width) >= read(floorTop, at % width) + height * 0.015) usable[at] = 1;
    }

    // A shadow shows on the floor as a step: lightness across a few pixels
    // either way changing by a twentieth or more of the brighter side, which
    // the floor's own falloff never does. A line walked across the floor goes
    // one shadow deeper at each step down and one shallower at each step up,
    // and marks what it reaches two deep. Steps closer together than
    // `plateau` pixels are the two ends of one soft edge rather than two.
    const span = Math.max(2, Math.round(width * 0.006));
    const plateau = 4;
    const step = 0.05;
    const byRow = new Uint8Array(floor.length);
    const byColumn = new Uint8Array(floor.length);

    const walk = (line: readonly number[], marks: Uint8Array): void => {
      let depth = 0;
      let flat = plateau;
      let last = 0;

      for (let index = 0; index < line.length; index += 1) {
        const at = read(line, index);
        const before = read(line, index - span);
        const after = read(line, index + span);
        const onFloor =
          index >= span &&
          index + span < line.length &&
          usable[at] === 1 &&
          usable[before] === 1 &&
          usable[after] === 1;

        if (!onFloor) {
          depth = 0;
          flat = plateau;
          last = 0;
          continue;
        }

        const change =
          (lightness(after) - lightness(before)) /
          Math.max(lightness(before), lightness(after), 1);
        const direction = change <= -step ? -1 : change >= step ? 1 : 0;

        if (direction === 0) {
          flat += 1;
          if (depth >= 2) marks[at] = 1;
        } else {
          if (flat >= plateau || direction !== last) depth = Math.max(0, depth - direction);
          flat = 0;
          last = direction;
        }
      }
    };

    for (let y = 0; y < height; y += 1) {
      const row = Array.from({ length: width }, (_, x) => y * width + x);

      walk(row, byRow);
      walk(row.reverse(), byRow);
    }
    for (let x = 0; x < width; x += 1) {
      const column = Array.from({ length: height }, (_, y) => y * width + x);

      walk(column, byColumn);
      walk(column.reverse(), byColumn);
    }

    // Only a solid patch of marks counts. A line walked along the edge of one
    // shadow steps down twice without ever leaving it, and what it marks is a
    // line a pixel or two wide rather than a patch.
    const reach = 2;
    const patch = (2 * reach + 1) ** 2;
    const stride = width + 1;
    const marked = (at: number): number => read(byRow, at) | read(byColumn, at);
    // How many pixels are marked above and to the left of each corner of the
    // pixel grid, so the count inside any box is four lookups.
    const counts = new Int32Array(stride * (height + 1));

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        counts[(y + 1) * stride + x + 1] =
          marked(y * width + x) +
          read(counts, y * stride + x + 1) +
          read(counts, (y + 1) * stride + x) -
          read(counts, y * stride + x);
      }
    }

    let overlapping = 0;

    for (let y = reach; y < height - reach; y += 1) {
      for (let x = reach; x < width - reach; x += 1) {
        if (marked(y * width + x) !== 1) continue;

        const above = (y - reach) * stride;
        const below = (y + reach + 1) * stride;
        const inBox =
          read(counts, below + x + reach + 1) -
          read(counts, above + x + reach + 1) -
          read(counts, below + x - reach) +
          read(counts, above + x - reach);

        if (inBox >= patch * 0.6) overlapping += 1;
      }
    }

    const wall = (from: number, to: number): number => {
      const seen: number[] = [];

      for (let x = Math.round(width * from); x < Math.round(width * to); x += 2) {
        const seam = found.rows[x] ?? 0;

        // A little above the seam, and never below the lower part of the
        // picture whatever the walk found.
        const lowest = Math.min(seam - Math.round(height * 0.02), Math.round(height * 0.7));

        for (let y = Math.round(height * 0.03); y < lowest; y += 2) {
          const at = y * width + x;

          if (saturation(at) <= 0.3 && lightness(at) <= 240) seen.push(lightness(at));
        }
      }
      seen.sort((one, other) => one - other);

      const dimmest = seen[Math.floor(seen.length * 0.05)] ?? 0;
      const brightest = seen[Math.floor(seen.length * 0.95)] ?? 0;

      return brightest / Math.max(dimmest, 0.5);
    };

    return {
      overlap: area === 0 ? 0 : (overlapping / area) * 100,
      walls: { left: wall(0.04, 0.3), right: wall(0.7, 0.96) },
    };
  }, seams);
