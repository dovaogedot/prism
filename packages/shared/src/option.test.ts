import { describe, expect, it } from "vitest";
import { Option } from "./option.ts";

describe("Option", () => {
  describe("construction and refinement", () => {
    it("distinguishes presence from absence", () => {
      expect(Option.isSome(Option.some(1))).toBe(true);
      expect(Option.isNone(Option.some(1))).toBe(false);
      expect(Option.isSome(Option.none)).toBe(false);
      expect(Option.isNone(Option.none)).toBe(true);
    });

    it("treats a present falsy value as present", () => {
      expect(Option.isSome(Option.some(0))).toBe(true);
      expect(Option.isSome(Option.some(""))).toBe(true);
      expect(Option.isSome(Option.some(false))).toBe(true);
    });
  });

  describe("the nullable boundary", () => {
    it("maps null and undefined to None", () => {
      expect(Option.fromNullable(null)).toEqual(Option.none);
      expect(Option.fromNullable(undefined)).toEqual(Option.none);
    });

    it("maps anything else to Some, including falsy values", () => {
      expect(Option.fromNullable(0)).toEqual(Option.some(0));
      expect(Option.fromNullable("")).toEqual(Option.some(""));
      expect(Option.fromNullable(false)).toEqual(Option.some(false));
    });

    it("round-trips back to a nullable column value", () => {
      expect(Option.toNullable(Option.some("hex"))).toBe("hex");
      expect(Option.toNullable(Option.none)).toBe(null);
    });

    it("round-trips through both directions unchanged", () => {
      const values = [0, "", false, 42, "colour"];
      for (const value of values) {
        expect(Option.toNullable(Option.fromNullable(value))).toBe(value);
      }
    });
  });

  describe("fromPredicate", () => {
    const nonEmpty = Option.fromPredicate<string>((text) => text.length > 0);

    it("keeps values satisfying the predicate", () => {
      expect(nonEmpty("red")).toEqual(Option.some("red"));
    });

    it("discards values failing it", () => {
      expect(nonEmpty("")).toEqual(Option.none);
    });
  });

  describe("map", () => {
    const double = Option.map<number, number>((value) => value * 2);

    it("transforms a present value", () => {
      expect(double(Option.some(21))).toEqual(Option.some(42));
    });

    it("leaves absence untouched", () => {
      expect(double(Option.none)).toEqual(Option.none);
    });

    it("obeys the identity law", () => {
      const identity = Option.map<number, number>((value) => value);
      expect(identity(Option.some(7))).toEqual(Option.some(7));
      expect(identity(Option.none)).toEqual(Option.none);
    });

    it("obeys the composition law", () => {
      const increment = (value: number) => value + 1;
      const triple = (value: number) => value * 3;
      const composed = Option.map<number, number>((value) => triple(increment(value)));
      const chained = (option: Option<number>) =>
        Option.map(triple)(Option.map(increment)(option));

      expect(composed(Option.some(4))).toEqual(chained(Option.some(4)));
    });
  });

  describe("flatMap", () => {
    const half = Option.flatMap<number, number>((value) =>
      value % 2 === 0 ? Option.some(value / 2) : Option.none,
    );

    it("flattens a successful step", () => {
      expect(half(Option.some(10))).toEqual(Option.some(5));
    });

    it("collapses when the step returns None", () => {
      expect(half(Option.some(7))).toEqual(Option.none);
    });

    it("short-circuits on absence without running the step", () => {
      let ran = false;
      const tracked = Option.flatMap<number, number>((value) => {
        ran = true;
        return Option.some(value);
      });

      expect(tracked(Option.none)).toEqual(Option.none);
      expect(ran).toBe(false);
    });
  });

  describe("filter", () => {
    const positive = Option.filter<number>((value) => value > 0);

    it("keeps values satisfying the predicate", () => {
      expect(positive(Option.some(3))).toEqual(Option.some(3));
    });

    it("drops values failing it", () => {
      expect(positive(Option.some(-3))).toEqual(Option.none);
    });

    it("leaves absence absent", () => {
      expect(positive(Option.none)).toEqual(Option.none);
    });
  });

  describe("elimination", () => {
    it("getOrElse returns the value when present", () => {
      expect(Option.getOrElse(() => 0)(Option.some(9))).toBe(9);
    });

    it("getOrElse computes the fallback only when absent", () => {
      let calls = 0;
      const fallback = () => {
        calls += 1;
        return 0;
      };

      expect(Option.getOrElse(fallback)(Option.some(9))).toBe(9);
      expect(calls).toBe(0);

      expect(Option.getOrElse(fallback)(Option.none)).toBe(0);
      expect(calls).toBe(1);
    });

    it("orElse supplies an alternative only when absent", () => {
      const alternative = () => Option.some("fallback");
      expect(Option.orElse(alternative)(Option.some("first"))).toEqual(
        Option.some("first"),
      );
      expect(Option.orElse(alternative)(Option.none)).toEqual(Option.some("fallback"));
    });

    it("match runs exactly one branch", () => {
      const describe_ = Option.match<number, string>({
        onSome: (value) => `got ${value}`,
        onNone: () => "nothing",
      });

      expect(describe_(Option.some(5))).toBe("got 5");
      expect(describe_(Option.none)).toBe("nothing");
    });
  });

  describe("collections", () => {
    it("all collects when every entry is present", () => {
      expect(Option.all([Option.some(1), Option.some(2)])).toEqual(
        Option.some([1, 2]),
      );
    });

    it("all collapses when any entry is absent", () => {
      expect(Option.all([Option.some(1), Option.none, Option.some(3)])).toEqual(
        Option.none,
      );
    });

    it("all of an empty list is an empty list", () => {
      expect(Option.all([])).toEqual(Option.some([]));
    });

    it("compact drops absent entries instead of collapsing", () => {
      expect(Option.compact([Option.some("a"), Option.none, Option.some("b")])).toEqual([
        "a",
        "b",
      ]);
    });
  });
});
