/** A rejected request as something a person can read. */

import type { ReactNode } from "react";
import { Api } from "../../../shared/api/client.ts";
import { IssueList } from "../../../shared/ui/index.ts";

export const Failure = {
  /** The sentence for a request that never reached the server. */
  OFFLINE: "We could not reach the server. Try again.",

  /** One sentence for a caught value. */
  message: (reason: unknown): string => Api.failureOf(reason)?.message ?? Failure.OFFLINE,

  /** Field issues listed when the server rejected fields; one sentence otherwise. */
  describe: (reason: unknown): ReactNode => {
    const failure = Api.failureOf(reason);

    if (failure === undefined) return Failure.OFFLINE;

    return failure.issues.length > 0 ? <IssueList issues={failure.issues} /> : failure.message;
  },
} as const;
