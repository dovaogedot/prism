/**
 * The challenge token the sign-in page hands to the second step in
 * navigation state, rather than the URL, where it would end up in history
 * and referrers.
 */

import { ChallengeToken } from "@prism/shared";
import { z } from "zod";

const carried = z.object({ challengeToken: ChallengeToken.schema });

export const ChallengeState = {
  /**
   * The token a navigation state carries, or `undefined` when it carries no
   * valid one: the page was opened cold, or reached from a provider sign-in,
   * which leaves the challenge in an httpOnly cookie instead.
   */
  read: (state: unknown): ChallengeToken | undefined => {
    const parsed = carried.safeParse(state);

    return parsed.success ? parsed.data.challengeToken : undefined;
  },
} as const;
