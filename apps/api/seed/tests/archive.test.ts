import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Archive } from "../archive.ts";

describe("Archive", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "prism-archive-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true });
  });

  it("unpacks what it packed: the catalog and every picture", async () => {
    const source = join(directory, "source");
    const target = join(directory, "target");
    await mkdir(join(source, "media"), { recursive: true });
    await writeFile(join(source, "catalog.json"), '{"categories":[]}');
    await writeFile(join(source, "media", "a.png"), new Uint8Array([1, 2, 3]));
    await writeFile(join(source, "media", "b.png"), new Uint8Array([4, 5]));

    await Archive.unpack(await Archive.pack(source), target);

    expect(await readFile(join(target, "catalog.json"), "utf8")).toBe('{"categories":[]}');
    expect([...(await readFile(join(target, "media", "a.png")))]).toEqual([1, 2, 3]);
    expect([...(await readFile(join(target, "media", "b.png")))]).toEqual([4, 5]);
  });

  it("reads one file out of the zip, and nothing for a name the zip does not hold", async () => {
    await mkdir(join(directory, "media"), { recursive: true });
    await writeFile(join(directory, "catalog.json"), '{"categories":[]}');
    await writeFile(join(directory, "media", "a.png"), new Uint8Array([1, 2, 3]));
    const bytes = await Archive.pack(directory);

    expect(new TextDecoder().decode(Archive.read(bytes, "catalog.json"))).toBe('{"categories":[]}');
    expect(Archive.read(bytes, "media/a.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(Archive.read(bytes, "missing.json")).toBeUndefined();
  });

  it("replaces a file that is already there", async () => {
    const source = join(directory, "source");
    await mkdir(join(source, "media"), { recursive: true });
    await writeFile(join(source, "catalog.json"), "new");
    const bytes = await Archive.pack(source);
    await writeFile(join(source, "catalog.json"), "old");

    await Archive.unpack(bytes, source);

    expect(await readFile(join(source, "catalog.json"), "utf8")).toBe("new");
  });
});
