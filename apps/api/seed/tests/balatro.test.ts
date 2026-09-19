import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";
import { Balatro } from "../fetch/catalog/balatro.ts";

describe("Balatro.plain", () => {
  it("keeps the words of links and spans and drops files, tags and hidden metadata", () => {
    expect(
      Balatro.plain(
        'Played cards with [[File:Club suit icon.png|class=suit-icon|link=Card Suits#Club suit]][[Card Suits#Club suit|<span class="suit-club">\'\'\'&nbsp;Club\'\'\'</span>]] suit give <span class="hl-mult">+3</span>&nbsp;[[Mult]] when scored',
      ),
    ).toBe("Played cards with Club suit give +3 Mult when scored");

    expect(
      Balatro.plain(
        'Copy of <span class="metadata-dpl metadata noexcerpt noprint" style="display: none;"> (<nowiki>{{Tarot|}} The Fool.png</nowiki>)</span>[[The Fool|<span class="hl-purple">The Fool</span>]] <br> (<span class="hl-gray">once</span>)',
      ),
    ).toBe("Copy of The Fool (once)");
  });
});

describe("Balatro.jokerNames and dollars", () => {
  it("lists every name in the Lua data, and reads the dollars off a cost field", () => {
    expect(Balatro.jokerNames('j_joker = {\n name = "Joker",\n}, j_x = { name = "Greedy Joker" }')).toEqual(["Joker", "Greedy Joker"]);
    expect(Balatro.dollars("20 (cannot be found in shop)", 5)).toBe(20);
    expect(Balatro.dollars(undefined, 5)).toBe(5);
  });
});

describe("Balatro.playingCards", () => {
  it("deals fifty-two cards, sorted into number, face and ace, each with an edition and an enhancement", () => {
    faker.seed(1);
    const cards = Balatro.playingCards();
    const kinds = new Map<string, number>();
    for (const card of cards) kinds.set(card.properties["kind"] ?? "", (kinds.get(card.properties["kind"] ?? "") ?? 0) + 1);

    expect(cards.length).toBe(52);
    expect(new Set(cards.map((card) => card.name)).size).toBe(52);
    expect([...kinds.entries()].sort()).toEqual([["Ace", 4], ["Face card", 12], ["Number card", 36]]);
    expect(cards.every((card) => card.properties["edition"] !== undefined && card.properties["enhancement"] !== undefined)).toBe(true);
    expect(cards.find((card) => card.name === "10 of Hearts")?.description).toContain("worth 10 chips");
  });
});

describe("Balatro.finishes", () => {
  it("puts the enhancement's face before the edition's shader, and nothing on a plain card", () => {
    expect(Balatro.finishes({ edition: "Base", enhancement: "None" })).toEqual([]);
    expect(Balatro.finishes({ type: "Deck" })).toEqual([]);

    const [gold, negative] = Balatro.finishes({ edition: "Negative", enhancement: "Gold" });
    expect(gold?._tag).toBe("Face");
    expect(gold?._tag === "Face" ? gold.picture : undefined).toMatchObject({ left: 852, top: 0, width: 142, height: 190, unit: 2 });
    expect(negative?._tag === "Shader" ? negative.shade : undefined).toBe(Balatro.SHADERS.Negative);
  });

  it("keeps the rank and suit off a stone card", () => {
    const [stone] = Balatro.finishes({ enhancement: "Stone" });
    expect(stone?._tag === "Face" ? stone.ink({ r: 0, g: 0, b: 0, a: 1 }) : true).toBe(false);
  });
});

describe("Balatro.ink", () => {
  it("takes the art and leaves the white face, its gray edge and the transparent corners", () => {
    expect(Balatro.ink({ r: 65 / 255, g: 82 / 255, b: 85 / 255, a: 1 })).toBe(true);
    expect(Balatro.ink({ r: 1, g: 1, b: 1, a: 1 })).toBe(false);
    expect(Balatro.ink({ r: 192 / 255, g: 200 / 255, b: 214 / 255, a: 1 })).toBe(false);
    expect(Balatro.ink({ r: 0, g: 0, b: 0, a: 0 })).toBe(false);
  });
});

describe("Balatro.SHADERS", () => {
  const white = { r: 1, g: 1, b: 1, a: 1 };
  const clear = { r: 0, g: 0, b: 0, a: 0 };

  it("turns white to the negative's dark cast", () => {
    const { r, g, b, a } = Balatro.SHADERS.Negative({ x: 0.5, y: 0.5 }, white);
    expect([r, g, b].map((channel) => Math.round(channel * 255))).toEqual([63, 79, 82]);
    expect(a).toBe(1);
  });

  it("tints a foil card blue and keeps every channel in range", () => {
    const { r, g, b, a } = Balatro.SHADERS.Foil({ x: 0.3, y: 0.7 }, white);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeLessThanOrEqual(1);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(a).toBe(1);
  });

  it("keeps a transparent pixel transparent and stays put for the same input", () => {
    for (const shade of Object.values(Balatro.SHADERS)) {
      expect(shade({ x: 0.2, y: 0.9 }, clear).a).toBe(0);
      expect(shade({ x: 0.2, y: 0.9 }, { r: 0.9, g: 0.2, b: 0.4, a: 1 })).toEqual(shade({ x: 0.2, y: 0.9 }, { r: 0.9, g: 0.2, b: 0.4, a: 1 }));
    }
  });
});

describe("Balatro.card", () => {
  it("names the joker's rarity, effect and activation, and prices it at its shop cost", () => {
    faker.seed(1);
    const card = Balatro.card("Joker", { title: "Gluttonous Joker", image: "Gluttonous Joker.png", rarity: "Common", type: "Additive Mult", activation: "On Scored", buyprice: "5" }, "Clubs give +3 Mult");

    expect(card.priceCents).toBe(500);
    expect(card.description).toBe("Clubs give +3 Mult");
    expect(card.properties).toMatchObject({ type: "Joker", rarity: "Common", effect: "Additive Mult", activation: "On Scored" });
    expect(card.properties["edition"]).toBeDefined();
  });

  it("gives a voucher its tier and ten dollars, and refuses a box without a title", () => {
    expect(Balatro.card("Voucher", { title: "Antimatter", image: "Antimatter.png", type: "Upgraded" }, "+1 Joker slot")).toMatchObject({ priceCents: 1000, properties: { type: "Voucher", tier: "Upgraded" } });
    expect(() => Balatro.card("Deck", { image: "x.png" }, "")).toThrow();
  });
});
