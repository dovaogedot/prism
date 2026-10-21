import { describe, expect, it } from "vitest";
import { ReviewNotice } from "../src/features/reviews/reviews.ts";

describe("what the review form tells its reader", () => {
  it("tells a reader without a delivered order why there is no form", () => {
    expect(ReviewNotice.of({ canReview: false, reason: "not_delivered" })).toMatchObject({
      title: "Reviews come from buyers",
      text: "You can review this product once an order of it has been delivered to you.",
    });
  });

  it("says nothing to a buyer who has not written one yet", () => {
    expect(ReviewNotice.of({ canReview: true })).toBeUndefined();
  });

  it("says a written review waits for a moderator, and that a published one would go back to one", () => {
    expect(ReviewNotice.ofOwn({ status: "pending" }).title).toBe("Your review is waiting for a moderator");
    expect(ReviewNotice.ofOwn({ status: "approved" }).text).toBe("Changing it sends it to a moderator again.");
  });

  it("gives the moderator's reason for a rejection, as a warning", () => {
    expect(ReviewNotice.ofOwn({ status: "rejected", rejectionReason: "It names another customer." })).toEqual({
      tone: "danger",
      title: "A moderator did not publish your review",
      text: "It names another customer. Change it and send it again.",
    });
    expect(ReviewNotice.ofOwn({ status: "rejected" }).text).toBe("No reason was given. Change it and send it again.");
  });
});
