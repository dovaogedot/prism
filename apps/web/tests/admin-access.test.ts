import { QueryCache, QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { AdminAccess, AdminKeys } from "../src/features/admin/admin.ts";
import { ApiError } from "../src/shared/api/client.ts";

const stepUp = new ApiError(403, { code: "TwoFactorVerificationRequired", message: "Confirm it is you.", issues: [] });

/**
 * A client wired the way main.tsx wires it, whose summary the API refuses for
 * a step-up. After a few refusals it answers, so a refetch loop ends and fails
 * the count instead of hanging the run.
 */
const clientRefusingTheSummary = () => {
  let fetches = 0;

  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError: (reason, query) => AdminAccess.onFailure(client, reason, query.queryKey) }),
  });

  const observer = new QueryObserver(client, {
    queryKey: AdminKeys.summary,
    queryFn: async () => {
      fetches += 1;
      if (fetches > 5) return {};
      throw stepUp;
    },
    retry: false,
  });
  const unsubscribe = observer.subscribe(() => {});

  return { client, fetches: () => fetches, unsubscribe };
};

describe("AdminAccess.onFailure", () => {
  it("fetches a summary that asks for a step-up once, so the gate can show the code form", async () => {
    const { client, fetches, unsubscribe } = clientRefusingTheSummary();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(fetches()).toBe(1);
    expect(client.getQueryState(AdminKeys.summary)?.status).toBe("error");
    unsubscribe();
  });

  it("asks the summary again when another admin read is refused for a step-up", async () => {
    const { client, fetches, unsubscribe } = clientRefusingTheSummary();
    await new Promise((resolve) => setTimeout(resolve, 50));

    AdminAccess.onFailure(client, stepUp, AdminKeys.list("orders", ""));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetches()).toBe(2);
    unsubscribe();
  });
});
