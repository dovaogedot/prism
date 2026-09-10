/**
 * Renders the stills of every product it is handed, in a headless browser.
 *
 *   node scripts/render-stills.ts <jobs.json | -> <directory>
 *
 * The jobs are what `apps/api/src/db/stills.ts` prints, read from a file or,
 * given `-`, from standard input. Each product's scene
 * is rendered from every angle in `STILL_ANGLES` under both themes, and each
 * picture is written to `stillPath` under the directory.
 *
 * The pictures are drawn by the storefront's own stages, on `stills.html`
 * served from source, so a still is exactly what the live scene draws. A
 * headless browser draws with a software rasterizer, which the storefront
 * turns down in a shopper's browser because it is slow. Here slow is fine, so
 * the page is told the rasterizer is hardware.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { text } from "node:stream/consumers";
import { fileURLToPath } from "node:url";
import {
  STILL_ANGLES,
  STILL_THEMES,
  stillPath,
  type StillJob,
} from "@prism/shared";
import { chromium, type Page } from "playwright";
import { createServer } from "vite";
import { z } from "zod";
import type { StillRequest } from "../src/stills/bridge.ts";

/** Edge length of every still, in pixels. */
const SIZE = 1024;

/**
 * How many pages render at once.
 *
 * Each page has its own context, and a software rasterizer spreads one draw
 * over a few cores, so a few pages keep the rest of them busy.
 */
const PAGES = 3;

/**
 * Draw through the system's OpenGL ES over EGL, which is Mesa's llvmpipe on a
 * machine with no GPU, rather than through the SwiftShader the browser ships
 * with. EGL needs no display, so this holds in a container too.
 *
 * Both rasterize on the CPU and the two agree to within a level of 255, but
 * llvmpipe shades these materials about four times faster.
 */
const RASTERIZER = ["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=gl-egl"];

/** `WEBGL_debug_renderer_info.UNMASKED_RENDERER_WEBGL`. */
const UNMASKED_RENDERER_WEBGL = 0x9246;

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** A product's slug, which also names a directory, so nothing in it can climb out of one. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const JOBS = z.array(
  z.object({
    slug: z.string().regex(SLUG),
    subject: z.union([
      z.object({
        kind: z.literal("color"),
        hex: z.string(),
        roughness: z.number(),
        coatingNanometers: z.number(),
        emission: z.number(),
      }),
      z.object({
        kind: z.literal("finisher"),
        applies: z.literal("roughness"),
        roughness: z.number(),
      }),
      z.object({
        kind: z.literal("finisher"),
        applies: z.literal("coating"),
        coatingNanometers: z.number(),
      }),
      z.object({
        kind: z.literal("finisher"),
        applies: z.literal("emission"),
        emission: z.number(),
      }),
    ]),
  }),
);

const WEBP = "data:image/webp;base64,";

/** Render one picture on a page that is already open on the stills page. */
const still = async (page: Page, request: StillRequest): Promise<Buffer> => {
  const url = await page.evaluate((asked) => window.prismStills.render(asked), request);

  if (!url.startsWith(WEBP)) {
    throw new Error(`The browser handed back something other than a WebP: ${url.slice(0, 32)}`);
  }

  return Buffer.from(url.slice(WEBP.length), "base64");
};

/** Take jobs off the queue until it is empty, writing every still of each. */
const work = async (page: Page, queue: StillJob[], directory: string): Promise<number> => {
  let written = 0;

  for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
    for (const angle of STILL_ANGLES) {
      for (const theme of STILL_THEMES) {
        const file = join(directory, stillPath(job.slug, angle, theme));

        await mkdir(dirname(file), { recursive: true });
        await writeFile(
          file,
          await still(page, { slug: job.slug, subject: job.subject, angle, theme, size: SIZE }),
        );
        written += 1;
      }
    }
  }

  return written;
};

const [jobsFile, directory] = process.argv.slice(2);

if (jobsFile === undefined || directory === undefined) {
  process.stderr.write("Usage: node scripts/render-stills.ts <jobs.json | -> <directory>\n");
  process.exit(2);
}

const listed = jobsFile === "-" ? await text(process.stdin) : await readFile(jobsFile, "utf8");
const jobs = JOBS.parse(JSON.parse(listed));
const started = performance.now();

const server = await createServer({
  root: WEB_ROOT,
  configFile: join(WEB_ROOT, "vite.config.ts"),
  server: { host: "127.0.0.1", port: 0 },
  logLevel: "error",
  clearScreen: false,
});
await server.listen();

const origin = server.resolvedUrls?.local[0];

if (origin === undefined) {
  process.stderr.write("The stills page could not be served.\n");
  process.exit(1);
}

const browser = await chromium.launch({ args: RASTERIZER });

// Asked on a page of its own, before anything is told the rasterizer is
// hardware, so the log says what actually drew the pictures.
const probe = await browser.newPage();
const rasterizer = await probe.evaluate(() => {
  const gl = document.createElement("canvas").getContext("webgl2");
  const info = gl?.getExtension("WEBGL_debug_renderer_info");

  return gl === null || gl === undefined || info === null || info === undefined
    ? "no WebGL2"
    : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
});
await probe.close();

process.stdout.write(`Rendering with ${rasterizer}.\n`);

const context = await browser.newContext({
  viewport: { width: SIZE, height: SIZE },
  deviceScaleFactor: 1,
});

await context.addInitScript((parameter: number) => {
  const real = WebGL2RenderingContext.prototype.getParameter;

  WebGL2RenderingContext.prototype.getParameter = function (
    this: WebGL2RenderingContext,
    name: number,
  ): unknown {
    return name === parameter ? "Prism stills" : real.call(this, name);
  };
}, UNMASKED_RENDERER_WEBGL);

const pages = await Promise.all(
  Array.from({ length: Math.min(PAGES, jobs.length) }, async () => {
    const page = await context.newPage();

    await page.goto(new URL("stills.html", origin).href);
    await page.waitForFunction(() => "prismStills" in window);

    return page;
  }),
);

const queue = [...jobs];
const counts = await Promise.all(pages.map((page) => work(page, queue, directory)));

await browser.close();
await server.close();

const seconds = ((performance.now() - started) / 1000).toFixed(1);
const total = counts.reduce((sum, count) => sum + count, 0);

process.stdout.write(`Rendered ${total} stills of ${jobs.length} products in ${seconds}s.\n`);
