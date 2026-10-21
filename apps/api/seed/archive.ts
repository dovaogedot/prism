/**
 * The seed's data as one file: `data.zip` holds `catalog.json` and the
 * pictures under `media/`. Run as a script, `node seed/archive.ts pack`
 * writes the archive from the unpacked data and `node seed/archive.ts unpack`
 * writes the data from the archive.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync, type Zippable } from "fflate";

export const Archive = {
  FILE: "data.zip",

  /** The zip bytes of `catalog.json` and every file under `media/` in `directory`. */
  pack: async (directory: string): Promise<Uint8Array> => {
    const media: Zippable = {};

    for (const name of (await readdir(join(directory, "media"))).sort()) {
      media[name] = await readFile(join(directory, "media", name));
    }

    return zipSync({ "catalog.json": await readFile(join(directory, "catalog.json")), media }, { level: 9 });
  },

  /** The file `name` in the zip `bytes`, read without unpacking the others; absent when the zip has no such file. */
  read: (bytes: Uint8Array, name: string): Uint8Array | undefined => unzipSync(bytes, { filter: (file) => file.name === name })[name],

  /** Writes every file of the zip `bytes` under `directory`, replacing the files already there. */
  unpack: async (bytes: Uint8Array, directory: string): Promise<void> => {
    for (const [name, content] of Object.entries(unzipSync(bytes))) {
      if (name.endsWith("/")) continue;

      await mkdir(dirname(join(directory, name)), { recursive: true });
      await writeFile(join(directory, name), content);
    }
  },
} as const;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL("./", import.meta.url));
  const file = join(directory, Archive.FILE);

  switch (process.argv[2]) {
    case "pack":
      await writeFile(file, await Archive.pack(directory));
      break;
    case "unpack":
      await Archive.unpack(await readFile(file), directory);
      break;
    default:
      process.stderr.write("Usage: node seed/archive.ts pack|unpack\n");
      process.exit(1);
  }
}
