import { describe, expect, it } from "vitest";
import { Combobox, type ComboboxState } from "../src/features/catalog/combobox.ts";

const open = (active?: number): ComboboxState => (active === undefined ? { isOpen: true } : { isOpen: true, active });

describe("the search box's keys", () => {
  it("opens the list on the first option with ArrowDown, and on the last with ArrowUp", () => {
    expect(Combobox.key(Combobox.CLOSED, "ArrowDown", 4)).toEqual({ state: open(0), action: { kind: "none" }, isHandled: true });
    expect(Combobox.key(Combobox.CLOSED, "ArrowUp", 4).state).toEqual(open(3));
  });

  it("moves through the options and wraps around at both ends", () => {
    expect(Combobox.key(open(1), "ArrowDown", 4).state).toEqual(open(2));
    expect(Combobox.key(open(3), "ArrowDown", 4).state).toEqual(open(0));
    expect(Combobox.key(open(0), "ArrowUp", 4).state).toEqual(open(3));
    expect(Combobox.key(open(), "ArrowDown", 4).state).toEqual(open(0));
  });

  it("leaves the arrows to the browser when there is nothing to move through", () => {
    expect(Combobox.key(Combobox.CLOSED, "ArrowDown", 0)).toEqual({ state: Combobox.CLOSED, action: { kind: "none" }, isHandled: false });
  });

  it("opens the active option with Enter, and searches for the text when none is active", () => {
    expect(Combobox.key(open(2), "Enter", 4)).toEqual({ state: Combobox.CLOSED, action: { kind: "choose", index: 2 }, isHandled: true });
    expect(Combobox.key(open(), "Enter", 4).action).toEqual({ kind: "submit" });
    expect(Combobox.key(Combobox.CLOSED, "Enter", 0).action).toEqual({ kind: "submit" });
  });

  it("searches rather than opening an option that is gone", () => {
    expect(Combobox.key(open(5), "Enter", 2).action).toEqual({ kind: "submit" });
  });

  it("closes the list with Escape, and clears the box with a second Escape", () => {
    const first = Combobox.key(open(1), "Escape", 4);
    const second = Combobox.key(first.state, "Escape", 4);

    expect(first).toEqual({ state: Combobox.CLOSED, action: { kind: "none" }, isHandled: true });
    expect(second.action).toEqual({ kind: "clear" });
  });

  it("closes the list on Tab without keeping focus from moving on", () => {
    expect(Combobox.key(open(1), "Tab", 4)).toEqual({ state: Combobox.CLOSED, action: { kind: "none" }, isHandled: false });
  });

  it("leaves every other key to the input", () => {
    expect(Combobox.key(open(1), "a", 4)).toEqual({ state: open(1), action: { kind: "none" }, isHandled: false });
  });

  it("lets go of an active option the list no longer holds", () => {
    expect(Combobox.clamp(open(3), 2)).toEqual(open());
    expect(Combobox.clamp(open(1), 2)).toEqual(open(1));
  });
});
