import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { Isaac, type Entry } from "../../../scripts/catalog/isaac.ts";

const css = `.item{height:50px}.rep-item{background:url("../images/repentance-items2.png") top left no-repeat;width:50px;height:50px}.rep-item.rep553{background-position:0 0;width:52px;cursor:url(../images/hand.png),auto}.rebirth-card{background:url(../images/ap-cards2.png)}.rebirth-card.r-card01{background-position:-50px 0px;width:39px;height:50px}`;

const html = `<h2>Repentance Items (2)</h2>
<li class="textbox" data-tid="445"><a><div onclick="" class="item rep-item rep553"></div><span>
<p class="item-title">Mucormycosis</p><p class="r-itemid">ItemID: 553</p><p class="pickup">"Spore shot"</p><p class="quality">Quality: 3</p>
<p>Tears have a chance to fire a fungus tear</p><ul><p>Type: Passive</p><p>Item Pool: Item Room</p></ul><p class="tags">*, </p></span></a></li>
<li class="textbox"><a><div class="item rep-item rep553"></div><span><p class="item-title">Mom&#39;s Box</p><p class="quality">Quality: 2</p><p>Holds it.</p><ul><p>Type: Active</p><p>Recharge Time: 6 rooms</p></ul></span></a></li>
<h2>Consumables + Misc.</h2>
<li class="textbox"><a><div class="rebirth-card item r-card01"></div><span><p class="item-title">O - The Fool?</p><p class="r-itemid">CardID: 56</p><p class="pickup">"Where your journey begins"</p><p>Teleports you.</p><p class="tags">*, tarot, card, green</p></span></a></li>`;

describe("Isaac.entries", () => {
  it("reads each entry under its heading, with its fields and its free paragraphs apart", () => {
    const [first, second, third] = Isaac.entries(html);

    expect(first).toMatchObject({ section: "Repentance Items (2)", name: "Mucormycosis", quote: "Spore shot", quality: "3", type: "Passive", recharge: undefined, card: false, classes: ["item", "rep-item", "rep553"] });
    expect(first?.paragraphs).toEqual(["Tears have a chance to fire a fungus tear"]);
    expect(second).toMatchObject({ name: "Mom's Box", type: "Active", recharge: "6 rooms" });
    expect(third).toMatchObject({ section: "Consumables + Misc.", name: "O - The Fool?", tags: ["*", "tarot", "card", "green"], card: true });
  });
});

describe("Isaac.sprite", () => {
  it("finds the sheet through one class and the slice through another, sized by the slice or the sheet", () => {
    const rules = Isaac.rules(css);

    expect(Isaac.sprite(rules, ["item", "rep-item", "rep553"])).toEqual({ _tag: "Sprite", url: "https://www.tboi.com/images/repentance-items2.png", left: 0, top: 0, width: 52, height: 50 });
    expect(Isaac.sprite(rules, ["rebirth-card", "item", "r-card01"])).toMatchObject({ url: "https://www.tboi.com/images/ap-cards2.png", left: 50, top: 0, width: 39, height: 50 });
    expect(Isaac.sprite(rules, ["item", "rep-item", "rep999"])).toBeUndefined();
  });
});

describe("Isaac.kind and product", () => {
  const entry = (fields: Partial<Entry>): Entry => ({ classes: [], section: "Consumables + Misc.", name: "", quote: "", paragraphs: [], quality: undefined, type: "", recharge: undefined, tags: [], card: false, ...fields });

  it("names items by their section and type, and consumables by their tags and names", () => {
    expect(Isaac.kind(entry({ section: "Rebirth Items (341)", type: "Active/Passive Item" }))).toBe("Active item");
    expect(Isaac.kind(entry({ section: "Afterbirth Items (95)", type: "Passive, Familiar" }))).toBe("Passive item");
    expect(Isaac.kind(entry({ section: "Rebirth Trinkets (60)" }))).toBe("Trinket");
    expect(Isaac.kind(entry({ name: "O - The Fool", tags: ["tarot"] }))).toBe("Tarot card");
    expect(Isaac.kind(entry({ name: "O - The Fool?", tags: ["tarot"] }))).toBe("Reversed tarot card");
    expect(Isaac.kind(entry({ name: "Rune of Hagalaz" }))).toBe("Rune");
    expect(Isaac.kind(entry({ name: "Soul of Isaac" }))).toBe("Soul");
    expect(Isaac.kind(entry({ name: "Gold Pill" }))).toBe("Pill");
    expect(Isaac.kind(entry({ name: "Chaos Card", card: true }))).toBe("Card");
    expect(Isaac.kind(entry({ name: "Gold Key" }))).toBe("Pickup");
  });

  it("writes the quote before the paragraphs and keeps only the properties the entry has", () => {
    faker.seed(1);
    const picture = { _tag: "Sprite", url: "https://www.tboi.com/images/x.png", left: 0, top: 0, width: 50, height: 50 } as const;
    const product = Isaac.product(entry({ section: "Repentance Items (173)", name: "Mucormycosis", quote: "Spore shot", paragraphs: ["Tears stick."], quality: "3", type: "Passive" }), picture);

    expect(product.description).toBe("Spore shot. Tears stick.");
    expect(product.properties).toEqual({ type: "Passive item", quality: "3", expansion: "Repentance" });
    expect(product.finishes).toEqual([]);
    expect(product.priceCents % 100).toBe(0);
  });
});
