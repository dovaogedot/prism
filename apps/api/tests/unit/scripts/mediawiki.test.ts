import { describe, expect, it } from "vitest";
import { MediaWiki } from "../../../scripts/catalog/mediawiki.ts";

const hierophant = `{{Consumable info
| number = 7
| title = The Hierophant
| image = The Hierophant.png
| effect = Enhances {{hl|orange|2}} selected cards to [[Bonus cards|{{hl|orange|Bonus Cards}}]]
| type = Tarot
| buyprice = 3
}}
'''The Hierophant''' is a {{Tarot|}} card.`;

describe("MediaWiki.infobox", () => {
  it("reads the parameters, keeping the templates inside a value whole", () => {
    const box = MediaWiki.infobox(hierophant, "Consumable info");

    expect(box?.["title"]).toBe("The Hierophant");
    expect(box?.["effect"]).toBe("Enhances {{hl|orange|2}} selected cards to [[Bonus cards|{{hl|orange|Bonus Cards}}]]");
    expect(box?.["buyprice"]).toBe("3");
  });

  it("drops a comment inside a value, and finds no box on a page without one", () => {
    expect(MediaWiki.infobox("{{Deck info\n|limit = No {{F|Face Cards}}<!-- keep --> here\n}}", "Deck info")?.["limit"]).toBe("No {{F|Face Cards}} here");
    expect(MediaWiki.infobox(hierophant, "Joker info")).toBeUndefined();
  });
});

describe("MediaWiki.chunks", () => {
  it("cuts a list into runs of the size, the last one shorter", () => {
    expect(MediaWiki.chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(MediaWiki.chunks([], 2)).toEqual([]);
  });
});
