/**
 * The same picture every time.
 *
 * Some of what a scene is made of looks scattered by hand — a grain that is
 * not a pattern, a speckle that is not a grid. None of it is chosen at draw
 * time: it is drawn from a fixed number, so the picture is part of the design
 * rather than something that differs per visit or per machine.
 */

/**
 * Mulberry32. Small, fast, and — the only property that matters here — the
 * same sequence on every machine, so what it decides is part of the design
 * rather than something that differs per visit.
 *
 * Returns a fresh generator each call, holding its own state. Every value it
 * yields is at least 0 and below 1.
 */
export const randomFrom = (seed: number): (() => number) => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4294967296;
  };
};
