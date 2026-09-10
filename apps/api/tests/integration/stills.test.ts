/**
 * Storing the rendered stills as product images, against a real Postgres and
 * real directories.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  STILL_ANGLES,
  STILL_THEMES,
  stillPath,
  type StillJob,
} from "@prism/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { refreshStills, type StillDirectories } from "../../src/db/stills.ts";
import { jsonOf, seedCatalog, startHarness, type Harness } from "../support/harness.ts";

let harness: Harness;
let directories: StillDirectories;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [
    { slug: "void-black", name: "Void Black", hex: "#0a0a0a", priceCents: 900 },
  ]);

  const root = await mkdtemp(join(tmpdir(), "hue-stills-"));
  directories = { stills: join(root, "stills"), media: join(root, "media") };
});

afterEach(async () => {
  await rm(dirname(directories.stills), { recursive: true, force: true });
});

const JOB: StillJob = {
  slug: "void-black",
  subject: { kind: "color", hex: "#0a0a0a", roughness: 88, coatingNanometers: 0, emission: 0 },
};

/** Bytes that stand in for one rendered still; the refresh stores them as they are. */
const stillBytes = (label: string): Buffer => Buffer.from(`RIFF----WEBP ${label}`);

const nameOf = (bytes: Buffer): string =>
  `${createHash("sha256").update(bytes).digest("hex")}.webp`;

/** Write every still of the job, each labeled with `version` so a re-render differs. */
const render = async (version: string): Promise<void> => {
  for (const angle of STILL_ANGLES) {
    for (const theme of STILL_THEMES) {
      const file = join(directories.stills, stillPath(JOB.slug, angle, theme));

      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, stillBytes(`${version} ${angle.name} ${theme}`));
    }
  }
};

const stored = () =>
  harness.database.sql<
    { filename: string; dark_filename: string; alt: string; position: number; uploaded: boolean }[]
  >`
    SELECT i.filename, i.dark_filename, i.alt, i.position, i.uploaded
    FROM product_image i JOIN product p ON p.id = i.product_id
    WHERE p.slug = 'void-black'
    ORDER BY i.uploaded, i.position
  `;

describe("refreshStills", () => {
  it("stores one image per angle, naming the still under each theme", async () => {
    await render("first");

    expect(await refreshStills(harness.database.db, directories, [JOB])).toBe(1);

    const rows = await stored();

    expect(rows).toHaveLength(STILL_ANGLES.length);
    rows.forEach((row, position) => {
      const angle = STILL_ANGLES[position];

      expect(row.position).toBe(position);
      expect(row.uploaded).toBe(false);
      expect(row.filename).toBe(nameOf(stillBytes(`first ${angle?.name} light`)));
      expect(row.dark_filename).toBe(nameOf(stillBytes(`first ${angle?.name} dark`)));
      expect(existsSync(join(directories.media, row.filename))).toBe(true);
      expect(existsSync(join(directories.media, row.dark_filename))).toBe(true);
    });
    expect(rows[0]?.alt).toBe("Void Black on a slab standing in a lit room, seen from the front");
  });

  it("changes nothing when the build rendered the same stills", async () => {
    await render("first");
    await refreshStills(harness.database.db, directories, [JOB]);
    const before = await stored();

    expect(await refreshStills(harness.database.db, directories, [JOB])).toBe(0);
    expect(await stored()).toEqual(before);
  });

  it("replaces the stills a new build rendered, and deletes the files nobody names", async () => {
    await render("first");
    await refreshStills(harness.database.db, directories, [JOB]);
    const before = await stored();

    await render("second");

    expect(await refreshStills(harness.database.db, directories, [JOB])).toBe(1);

    const after = await stored();
    const files = await readdir(directories.media);

    expect(after.map((row) => row.filename)).not.toEqual(before.map((row) => row.filename));
    expect(new Set(files)).toEqual(
      new Set(after.flatMap((row) => [row.filename, row.dark_filename])),
    );
  });

  it("leaves an uploaded photograph alone, and shows it after the stills", async () => {
    const photograph = `${"c".repeat(64)}.png`;

    await harness.database.sql`
      INSERT INTO product_image (product_id, filename, dark_filename, alt, position, uploaded)
      SELECT p.id, ${photograph}, ${photograph}, 'A photograph', 0, true
      FROM product p WHERE p.slug = 'void-black'
    `;
    await render("first");
    await refreshStills(harness.database.db, directories, [JOB]);

    const rows = await stored();

    expect(rows.filter((row) => row.uploaded).map((row) => row.filename)).toEqual([photograph]);

    harness.clock.advanceSeconds(harness.config.cache.productTtlSeconds + 1);
    const product = jsonOf(await harness.app.inject({ method: "GET", url: "/api/v1/products/void-black" }));
    const images = product["images"] as readonly Record<string, unknown>[];

    expect(images.map((image) => image["alt"])).toEqual([
      ...rows.filter((row) => !row.uploaded).map((row) => row.alt),
      "A photograph",
    ]);
    expect(images[0]?.["darkUrl"]).toBe(`/media/${rows[0]?.dark_filename}`);
  });

  it("stores nothing for a product one of whose stills is missing", async () => {
    await render("first");
    await rm(join(directories.stills, stillPath(JOB.slug, STILL_ANGLES[0], "dark")));

    await expect(refreshStills(harness.database.db, directories, [JOB])).rejects.toThrow();
    expect(await stored()).toEqual([]);
  });

  it("passes over a job whose product is not in the database", async () => {
    expect(
      await refreshStills(harness.database.db, directories, [{ ...JOB, slug: "no-such-color" }]),
    ).toBe(0);
  });
});
