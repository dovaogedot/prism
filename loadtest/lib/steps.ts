/**
 * The stress run's steps, which the run ramps through and the report reads
 * its samples by. Kept free of k6's modules, so Node loads it too.
 */

export const StressSteps = {
  /** The users each step reaches, in order. */
  TARGETS: [25, 50, 100, 150, 200, 300, 400, 500, 600, 800, 1000],
  /** How long a step takes to reach its users from the step before. */
  RAMP_SECONDS: 30,
  /** How long a step then holds its users. */
  HOLD_SECONDS: 60,
} as const;
