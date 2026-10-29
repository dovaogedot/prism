import { DomainError } from "@prism/shared";

/** The sentence the sign-in page shows for the reason a provider sign-in sent back in `?error=`. */
export const SignInFailure = {
  UNKNOWN: "Signing in with that account did not work. Please try again.",

  /** Whether `code` names a failure the shop knows. */
  isKnown: (code: string): code is keyof typeof DomainError.message => Object.hasOwn(DomainError.message, code),

  /** The shop's own sentence for a known failure, and one fixed sentence otherwise, so a link cannot put its own text on the page. */
  messageOf: (code: string): string => (SignInFailure.isKnown(code) ? DomainError.message[code] : SignInFailure.UNKNOWN),
} as const;
