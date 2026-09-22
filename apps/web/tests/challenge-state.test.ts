import { describe, expect, it } from "vitest";
import { ChallengeState } from "../src/features/auth/challenge-state.ts";

describe("ChallengeState.read", () => {
  it("returns the token a sign-in handed over", () => {
    expect(ChallengeState.read({ challengeToken: "t" })).toBe("t");
  });

  it("reads an empty token, a missing one and no state alike, as absent", () => {
    expect(ChallengeState.read({ challengeToken: "" })).toBeUndefined();
    expect(ChallengeState.read({})).toBeUndefined();
    expect(ChallengeState.read(null)).toBeUndefined();
    expect(ChallengeState.read(undefined)).toBeUndefined();
  });
});
