/**
 * The stills each product is shown with, and keeping the database in step with them.
 *
 * The storefront renders every color's and every finisher's scene ahead of
 * time, from each of `STILL_ANGLES` under both themes, into a directory the
 * API image carries (`apps/web/scripts/render-stills.ts`). This module says
 * which products those are, and stores what came back as their images.
 *
 *   node src/db/stills.ts     prints the jobs for the planned catalog, as JSON
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  Option,
  STILL_ANGLES,
  stillPath,
  type StillAngle,
  type StillJob,
  type StillSubject,
  type StillTheme,
} from "@prism/shared";
import { match } from "ts-pattern";
import type { Database } from "./client.ts";
import { createRandom } from "./palette.ts";
import { planCatalog, SEED, type PlannedProduct } from "./plan.ts";
import { productImages, products } from "./schema.ts";

/** What a product's scene is built from. `None` for a product that has no scene. */
const subjectOf = (planned: PlannedProduct): Option<StillSubject> =>
  match(planned)
    .with({ kind: "color" }, ({ hex, roughness, coatingNanometers, emission }) =>
      Option.some<StillSubject>({ kind: "color", hex, roughness, coatingNanometers, emission }),
    )
    .with({ kind: "finisher", applies: "roughness" }, ({ roughness }) =>
      Option.some<StillSubject>({ kind: "finisher", applies: "roughness", roughness }),
    )
    .with({ kind: "finisher", applies: "coating" }, ({ coatingNanometers }) =>
      Option.some<StillSubject>({ kind: "finisher", applies: "coating", coatingNanometers }),
    )
    .with({ kind: "finisher", applies: "emission" }, ({ emission }) =>
      Option.some<StillSubject>({ kind: "finisher", applies: "emission", emission }),
    )
    // Drawn in the browser from its own two numbers, so there is no scene.
    .with({ kind: "shifter" }, () => Option.none)
    .exhaustive();

/** Every planned product that has a scene to render, in the order of the plan. */
export const stillJobs = (plan: readonly PlannedProduct[]): readonly StillJob[] =>
  plan.flatMap((planned) =>
    Option.match<StillSubject, StillJob[]>({
      onSome: (subject) => [{ slug: planned.slug, subject }],
      onNone: () => [],
    })(subjectOf(planned)),
  );

/** What one still shows, for a reader who cannot see it. */
export const stillAlt = (name: string, subject: StillSubject, angle: StillAngle): string =>
  `${name} ${match(subject)
    .with({ kind: "color" }, () => "on a slab standing in a lit room")
    .with({ applies: "roughness" }, () => "done to a gray shape in a lit corner")
    .with({ applies: "coating" }, () => "done to two painted shapes in a lit corner")
    .with({ applies: "emission" }, () => "done to three shapes glowing in a dim room")
    .exhaustive()}, seen ${angle.seenFrom}`;

/** One still as a row stores it. */
type StoredStill = Readonly<{
  filename: string;
  darkFilename: string;
  alt: string;
  position: number;
}>;

/** Where the rendered stills are read from, and where the media they become is kept. */
export type StillDirectories = Readonly<{ stills: string; media: string }>;

/**
 * Put one file in the media directory under its content-addressed name.
 *
 * The name is the one the upload endpoint would give the same bytes, and a
 * file already there under it is already these bytes.
 */
const keep = async (media: string, bytes: Buffer): Promise<string> => {
  const filename = `${createHash("sha256").update(bytes).digest("hex")}.webp`;
  const path = join(media, filename);

  if (!existsSync(path)) await writeFile(path, bytes);

  return filename;
};

/** Copy one product's stills into the media directory, as the rows that will name them. */
const keepStills = (
  directories: StillDirectories,
  job: StillJob,
  name: string,
): Promise<readonly StoredStill[]> =>
  Promise.all(
    STILL_ANGLES.map(async (angle, position): Promise<StoredStill> => {
      const read = (theme: StillTheme): Promise<Buffer> =>
        readFile(join(directories.stills, stillPath(job.slug, angle, theme)));

      const [light, dark] = await Promise.all([read("light"), read("dark")]);

      return {
        filename: await keep(directories.media, light),
        darkFilename: await keep(directories.media, dark),
        alt: stillAlt(name, job.subject, angle),
        position,
      };
    }),
  );

const sameStills = (
  stored: readonly StoredStill[],
  wanted: readonly StoredStill[],
): boolean =>
  stored.length === wanted.length &&
  stored.every((row, index) => {
    const other = wanted[index];

    return (
      other !== undefined &&
      row.filename === other.filename &&
      row.darkFilename === other.darkFilename &&
      row.alt === other.alt &&
      row.position === other.position
    );
  });

/** Delete whichever of these files no image names any longer. */
const forgetUnused = async (
  db: Database,
  media: string,
  filenames: readonly string[],
): Promise<void> => {
  const candidates = [...new Set(filenames)];
  if (candidates.length === 0) return;

  const named = await db
    .select({ filename: productImages.filename, darkFilename: productImages.darkFilename })
    .from(productImages)
    .where(
      or(
        inArray(productImages.filename, candidates),
        inArray(productImages.darkFilename, candidates),
      ),
    );

  const inUse = new Set(named.flatMap((row) => [row.filename, row.darkFilename]));

  await Promise.all(
    candidates
      .filter((filename) => !inUse.has(filename))
      .map((filename) => rm(join(media, filename), { force: true })),
  );
};

/**
 * Make every job's product show exactly the stills rendered for it.
 *
 * A product's stills are the images of it that were not uploaded. They are
 * replaced as a set, in `STILL_ANGLES` order, whenever what was rendered
 * differs from what is stored; uploaded images are never touched, and a file
 * no image names any longer is deleted. A job whose product is not in the
 * database is passed over.
 *
 * Rejects, having stored nothing for that product, if any of its stills is
 * missing from the stills directory. Answers how many products changed.
 */
export const refreshStills = async (
  db: Database,
  directories: StillDirectories,
  jobs: readonly StillJob[],
): Promise<number> => {
  if (jobs.length === 0) return 0;

  await mkdir(directories.media, { recursive: true });

  const rows = await db
    .select({ id: products.id, slug: products.slug, name: products.name })
    .from(products)
    .where(inArray(products.slug, jobs.map((job) => job.slug)));

  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  let changed = 0;

  for (const job of jobs) {
    const product = bySlug.get(job.slug);
    if (product === undefined) continue;

    const wanted = await keepStills(directories, job, product.name);
    const isStill = and(
      eq(productImages.productId, product.id),
      eq(productImages.uploaded, false),
    );

    const stored = await db
      .select({
        filename: productImages.filename,
        darkFilename: productImages.darkFilename,
        alt: productImages.alt,
        position: productImages.position,
      })
      .from(productImages)
      .where(isStill)
      .orderBy(asc(productImages.position));

    if (sameStills(stored, wanted)) continue;

    await db.transaction(async (tx) => {
      await tx.delete(productImages).where(isStill);
      await tx
        .insert(productImages)
        .values(wanted.map((still) => ({ ...still, productId: product.id, uploaded: false })));
    });

    await forgetUnused(
      db,
      directories.media,
      stored.flatMap((row) => [row.filename, row.darkFilename]),
    );

    changed += 1;
  }

  return changed;
};

const isEntrypoint = process.argv[1] === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  process.stdout.write(`${JSON.stringify(stillJobs(planCatalog(createRandom(SEED))))}\n`);
}
