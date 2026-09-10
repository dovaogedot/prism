/**
 * The filters as the URL carries them, and which of them the rail has a control for.
 *
 * The rail offers the controls of the category chosen and of no other, and a
 * slider for each finish ticked, so what it shows follows from the category
 * and the finishes. A filter has to leave the URL when its control leaves the
 * rail, or it goes on narrowing the shelf with nothing on screen to say so and
 * nothing to clear it with.
 *
 * Pure, so the rules are tested without a browser.
 */

import {
  FINISH_AXES,
  FINISH_BANDS,
  FINISH_PROPERTIES,
  FINISHES,
  type FinishBand,
  type FinishProperty,
  type NumericRange,
} from "@prism/shared";

/**
 * Every filter, as the strings the URL carries them as.
 *
 * Strings rather than numbers because this is the query string's own shape: an
 * empty string is a filter nobody set, which keeps the URL free of `NaN`. A
 * list is empty while nothing in it is ticked.
 */
export type FacetState = Readonly<{
  /** The category, or "" for all three at once. */
  category: string;
  /** A color family, or "" for no claim about it. Set by search, not by the rail. */
  family: string;
  brands: readonly string[];
  /** The finishes ticked, which narrow the finishers. None ticked is every finish. */
  finish: readonly string[];
  direction: string;
  arcMin: string;
  arcMax: string;
  minRating: string;
  priceMin: string;
  priceMax: string;
  hueMin: string;
  hueMax: string;
  saturationMin: string;
  saturationMax: string;
  lightnessMin: string;
  lightnessMax: string;
  roughnessMin: string;
  roughnessMax: string;
  coatingMin: string;
  coatingMax: string;
  emissionMin: string;
  emissionMax: string;
}>;

/** The controls the rail offers beyond the ones every category shares. */
export type RailControls = Readonly<{
  /** The hue ring, the two ramps and the family a search chose, which only a color has. */
  colors: boolean;
  /** The finishes to tick, which only a finisher applies. */
  finishers: boolean;
  /** The arc and the direction, which only a shifter has. */
  shifters: boolean;
  /**
   * One slider per amount the shelf is narrowed by, each over the stretch of
   * its axis the shelf holds, in the order of `FINISH_PROPERTIES`.
   *
   * A color carries every amount there is, so on the colors every slider runs
   * its whole axis. A finisher carries the one amount its finish names, so on
   * the finishers there is a slider for each finish ticked, over the stretch
   * that finish names.
   */
  amounts: readonly FinishBand[];
}>;

/** Which controls the rail offers for the category and the finishes chosen in `state`. */
export const railControls = (state: Pick<FacetState, "category" | "finish">): RailControls => {
  const colors = state.category === "color";
  const finishers = state.category === "finisher";
  const ticked = FINISHES.filter((finish) => finishers && state.finish.includes(finish));

  return {
    colors,
    finishers,
    shifters: state.category === "shifter",
    amounts: FINISH_PROPERTIES.flatMap((property): readonly FinishBand[] =>
      colors
        ? [{ property, range: FINISH_AXES[property] }]
        : ticked
            .map((finish) => FINISH_BANDS[finish])
            .filter((band) => band.property === property),
    ),
  };
};

/** Whether a slider over `range` can show this end of a range. An unset end always can. */
const reachable = (bound: string, range: NumericRange): boolean =>
  bound === "" || (Number(bound) >= range.min && Number(bound) <= range.max);

/**
 * `state` with every filter the rail has no control for cleared.
 *
 * That is every filter of a category that is not the one chosen, the finishes
 * on any shelf but the finishers, the range on an amount no slider is offered
 * for, and an end of a range past either end of its slider. Everything else is
 * kept as it is.
 */
export const withoutHidden = (state: FacetState): FacetState => {
  const controls = railControls(state);

  const shown = (value: string, offered: boolean): string => (offered ? value : "");

  const amount = (property: FinishProperty, bound: string): string =>
    controls.amounts.some((band) => band.property === property && reachable(bound, band.range))
      ? bound
      : "";

  return {
    ...state,
    family: shown(state.family, controls.colors),
    hueMin: shown(state.hueMin, controls.colors),
    hueMax: shown(state.hueMax, controls.colors),
    saturationMin: shown(state.saturationMin, controls.colors),
    saturationMax: shown(state.saturationMax, controls.colors),
    lightnessMin: shown(state.lightnessMin, controls.colors),
    lightnessMax: shown(state.lightnessMax, controls.colors),
    finish: controls.finishers ? state.finish : [],
    roughnessMin: amount("roughness", state.roughnessMin),
    roughnessMax: amount("roughness", state.roughnessMax),
    coatingMin: amount("coating", state.coatingMin),
    coatingMax: amount("coating", state.coatingMax),
    emissionMin: amount("emission", state.emissionMin),
    emissionMax: amount("emission", state.emissionMax),
    direction: shown(state.direction, controls.shifters),
    arcMin: shown(state.arcMin, controls.shifters),
    arcMax: shown(state.arcMax, controls.shifters),
  };
};
