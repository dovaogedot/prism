/** The hand-written titles and descriptions: within the lengths search engines show, and each one used once. */

import { describe, expect, it } from "vitest";
import { PageText } from "../src/shared/seo/page-text.ts";
import { Seo } from "../src/shared/seo/seo.ts";

const pages = Object.entries(PageText);

describe("the fixed pages' head text", () => {
  it.each(pages)("gives %s a title within 60 characters", (_name, text) => {
    expect(Seo.title(text.title).length).toBeLessThanOrEqual(60);
    expect(Seo.title(text.title)).toBe(`${text.title} | Prism`);
  });

  it.each(pages)("gives %s a description of 155 to 160 characters", (_name, text) => {
    expect(text.description.length).toBeGreaterThanOrEqual(155);
    expect(text.description.length).toBeLessThanOrEqual(160);
  });

  it("uses each title and each description once", () => {
    expect(new Set(pages.map(([, text]) => text.title)).size).toBe(pages.length);
    expect(new Set(pages.map(([, text]) => text.description)).size).toBe(pages.length);
  });
});
