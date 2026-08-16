/**
 * Seeded credentials, shared by the specs that need an account.
 *
 * Outside `specs/` on purpose: Playwright refuses to let one test file import
 * another.
 */

export const SHOPPER = {
  email: "shopper@prism.test",
  password: "colors are not paint",
} as const;
