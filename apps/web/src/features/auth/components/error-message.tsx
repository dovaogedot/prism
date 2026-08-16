/** Turns a rejected request into something a person can read. */
import { messageOf } from "@prism/shared";
import type { ReactNode } from "react";
import { match } from "ts-pattern";
import { toApiFailure } from "../../../shared/api/client.ts";
import { IssueList } from "../../../shared/ui/index.ts";

export const describeFailure = (reason: unknown): ReactNode =>
  match(toApiFailure(reason))
    .with({ _tag: "Some" }, ({ value }) =>
      match(value.error)
        .with({ _tag: "ValidationFailed" }, (error) => (
          <IssueList issues={error.issues} />
        ))
        .otherwise((error) => messageOf(error)),
    )
    .with({ _tag: "None" }, () => "We could not reach the server. Try again.")
    .exhaustive();
