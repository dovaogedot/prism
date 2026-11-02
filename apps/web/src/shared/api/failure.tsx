/** A rejected request as something a person can read. */

import type { ValidationIssue } from "@prism/shared"
import type { ReactNode } from "react"
import { Api, NetworkError } from "./client.ts"
import { IssueList } from "../ui/index.ts"

export const Failure = {
  /** The sentence for a request that never reached the server. */
  OFFLINE: "We could not reach the server. Try again.",

  /** The sentence for a failure that is neither the API's refusal nor a lost connection: a fault of the page's own. */
  UNEXPECTED: "This page hit a fault of its own, not anything you entered. Reload it and try again.",

  /**
   * The sentence for a failure that is not the API's refusal: a lost
   * connection, or a fault of the page's own, which is logged as well.
   */
  unrefused: (reason: unknown): string => {
    if (reason instanceof NetworkError) return Failure.OFFLINE

    console.error(reason)
    return Failure.UNEXPECTED
  },

  /** One sentence for a caught value. */
  message: (reason: unknown): string => Api.failureOf(reason)?.message ?? Failure.unrefused(reason),

  /** Field issues listed when the server rejected fields; one sentence otherwise. */
  describe: (reason: unknown): ReactNode => {
    const failure = Api.failureOf(reason)

    if (failure === undefined) return Failure.unrefused(reason)

    return failure.issues.length > 0 ? <IssueList issues={failure.issues} /> : failure.message
  },

  /**
   * What a form shows above its fields for a refused save: the sentence when
   * the refusal named no field, the issues `place` could not put under a
   * field, or `undefined` when every issue sits under its own.
   */
  describeUnplaced: (reason: unknown, place: (issues: readonly ValidationIssue[]) => readonly ValidationIssue[]): ReactNode | undefined => {
    const failure = Api.failureOf(reason)
    if (failure === undefined || failure.issues.length === 0) return Failure.message(reason)

    const unplaced = place(failure.issues)

    return unplaced.length === 0 ? undefined : <IssueList issues={unplaced} />
  },
} as const
