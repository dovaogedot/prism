import { describe, expect, it } from "vitest";
import { Minecraft } from "../fetch/catalog/minecraft.ts";

describe("Minecraft.icons", () => {
  it("lists the invimage fields in order, skipping spacers, edition copies and markup", () => {
    expect(Minecraft.icons({ invimage10: "Tenth", invimage: "Chest", invimage2: "----", invimage3: "Chest BE", invimage4: "A|invimage5=B", invimage5: "[Crossbow]Loaded", invimage9: "Ninth" }, "Chest")).toEqual(["Chest", "Ninth", "Tenth"]);
  });

  it("falls back to the box's title when it is a name, then the page's", () => {
    expect(Minecraft.icons({ title: "Log/Stem" }, "Log")).toEqual(["Log/Stem"]);
    expect(Minecraft.icons({ title: "Except five:|content={{Sprite}}" }, "Leaves")).toEqual(["Leaves"]);
    expect(Minecraft.icons({ image: "Stone.png" }, "Stone")).toEqual(["Stone"]);
  });
});

describe("Minecraft fields", () => {
  it("reads the word a yes/no field leads with and nothing from a longer story", () => {
    expect(Minecraft.yesNo("No ([[Renewable resource#Vault|except via ominous vault]])")).toBe("No");
    expect(Minecraft.yesNo("Yes")).toBe("Yes");
    expect(Minecraft.yesNo("{{JEBE|No|Yes}}")).toBeUndefined();
    expect(Minecraft.yesNo(undefined)).toBeUndefined();
  });

  it("turns a stackable field into a stack size", () => {
    expect(Minecraft.stack("Yes (16), except in furnace fuel slot")).toBe("16");
    expect(Minecraft.stack("Yes")).toBe("64");
    expect(Minecraft.stack("No")).toBe("1");
    expect(Minecraft.stack("{{jebe|No|Yes (64)}}")).toBeUndefined();
  });

  it("takes the rarity the field leads with and calls a silent box common", () => {
    expect(Minecraft.rarity("Rare{{only|java|short=1}}<br>Common")).toBe("Rare");
    expect(Minecraft.rarity("common")).toBe("Common");
    expect(Minecraft.rarity(undefined)).toBe("Common");
    expect(Minecraft.rarity("Potato")).toBeUndefined();
  });

  it("spells a tool one way and drops markup", () => {
    expect(Minecraft.tool("Wooden Pickaxe")).toBe("Wooden pickaxe");
    expect(Minecraft.tool("any")).toBe("Any");
    expect(Minecraft.tool("{{tool|pickaxe}}")).toBeUndefined();
  });

  it("types a product by its box and fields", () => {
    expect(Minecraft.type({ hunger: "4" }, "Block")).toBe("Block");
    expect(Minecraft.type({ hunger: "4", durability: "1" }, "Item")).toBe("Food");
    expect(Minecraft.type({ attackdamage: "7", durability: "1561" }, "Item")).toBe("Weapon");
    expect(Minecraft.type({ armor: "3", durability: "165" }, "Item")).toBe("Armor");
    expect(Minecraft.type({ armorcustom: "{{JEBE|1|3}}", durability: "165" }, "Item")).toBe("Armor");
    expect(Minecraft.type({ durability: "59" }, "Item")).toBe("Tool");
    expect(Minecraft.type({}, "Item")).toBe("Item");
  });

  it("gathers the properties a box gives, leaving out what it does not say", () => {
    expect(Minecraft.properties({ tool: "axe", renewable: "Yes", stackable: "Yes (64)" }, "Block")).toEqual({ type: "Block", rarity: "Common", renewable: "Yes", "stack size": "64", tool: "Axe" });
    expect(Minecraft.properties({ rarity: "Epic", stackable: "No", tool: "axe" }, "Item")).toEqual({ type: "Item", rarity: "Epic", "stack size": "1" });
  });

  it("takes the first paragraph of an extract", () => {
    expect(Minecraft.blurb("A chest is a block used to store items.\nA large chest is two chests.")).toBe("A chest is a block used to store items.");
    expect(Minecraft.blurb("\n")).toBeUndefined();
    expect(Minecraft.blurb(undefined)).toBeUndefined();
  });
});
