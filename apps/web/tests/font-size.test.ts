/**
 * Font sizes are in rem everywhere, so text grows with the reader's own
 * browser setting. A pixel font size in a class or a stylesheet fails this.
 */

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = new URL("../src/", import.meta.url);

/** Every file under `src`, as a path relative to it. */
const files = readdirSync(source, { recursive: true, encoding: "utf8" }).filter((path) => /\.(tsx?|css)$/.test(path));

describe("font sizes", () => {
  it("finds the source files it scans", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("are never set in pixels", () => {
    const pixelSize = /text-\[\d+(\.\d+)?px\]|font-size:\s*\d+(\.\d+)?px|fontSize:\s*["']?\d+(\.\d+)?px/;
    const offending = files.filter((path) => pixelSize.test(readFileSync(new URL(path, source), "utf8")));

    expect(offending).toEqual([]);
  });

  it("would catch one", () => {
    expect(/text-\[\d+(\.\d+)?px\]/.test('className="text-[10px]"')).toBe(true);
  });
});
