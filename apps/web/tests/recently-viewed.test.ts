import { Slug } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { RecentlyViewed } from "../src/features/catalog/recently-viewed.ts";

const slug = (text: string): Slug => Slug.schema.parse(text);

describe("the recently viewed list", () => {
  it("puts the newest first", () => {
    expect(RecentlyViewed.add([slug("a"), slug("b")], slug("c"))).toEqual(["c", "a", "b"]);
  });

  it("moves a product viewed again to the front instead of listing it twice", () => {
    expect(RecentlyViewed.add([slug("a"), slug("b"), slug("c")], slug("b"))).toEqual(["b", "a", "c"]);
  });

  it("keeps at most twelve, dropping the oldest", () => {
    const full = Array.from({ length: 12 }, (_, index) => slug(`p-${index}`));
    const added = RecentlyViewed.add(full, slug("new"));

    expect(added).toHaveLength(12);
    expect(added[0]).toBe("new");
    expect(added).not.toContain("p-11");
  });

  it("reads a stored list, and anything else as an empty one", () => {
    expect(RecentlyViewed.parse('["a","b"]')).toEqual(["a", "b"]);
    expect(RecentlyViewed.parse(null)).toEqual([]);
    expect(RecentlyViewed.parse("not json")).toEqual([]);
    expect(RecentlyViewed.parse('{"a":1}')).toEqual([]);
    expect(RecentlyViewed.parse('["Not A Slug"]')).toEqual([]);
  });
});
