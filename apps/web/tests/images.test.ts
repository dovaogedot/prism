import { describe, expect, it } from "vitest";
import { urlUnder } from "../src/features/catalog/images.ts";

const STILL = {
  url: "/media/light.webp",
  darkUrl: "/media/dark.webp",
  alt: "",
  position: 0,
};

describe("urlUnder", () => {
  it("shows the light file under the light theme", () => {
    expect(urlUnder(STILL, "light")).toBe("/media/light.webp");
  });

  it("shows the dark file under the dark theme", () => {
    expect(urlUnder(STILL, "dark")).toBe("/media/dark.webp");
  });
});
