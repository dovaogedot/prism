/**
 * Reviews end to end: who may write one, the moderation that stands between
 * a review and the product page, helpful votes, and the orders a product's
 * reviews come in.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Shop } from "../support/commerce.ts";
import { jsonOf, registerUser, seedCatalog, startHarness, userIdOf, type Harness } from "../support/harness.ts";
import { Staff, type TestAccount } from "../support/staff.ts";

let harness: Harness;
let moderator: TestAccount;

beforeAll(async () => {
  harness = await startHarness();
}, 180_000);

afterAll(async () => {
  await harness.stop();
});

beforeEach(async () => {
  await harness.reset();
  await seedCatalog(harness, [{ slug: "desk-lamp", name: "Desk Lamp", priceCents: 2500, stock: 50 }]);
  moderator = await Staff.account(harness, "moderator@example.com", ["moderator"]);
});

type Page = {
  items: { id: string; rating: number; authorName: string; title?: string; body?: string; helpfulCount: number }[];
  average: number;
  count: number;
  distribution: Record<string, number>;
};

type Viewer = {
  canReview: boolean;
  reason?: string;
  own?: { id: string; status: string; rejectionReason?: string };
  votedReviewIds: string[];
};

const review = { rating: 4, authorName: "Mari", title: "Bright and steady", body: "Lights the whole desk." };

/** A customer with an order of the desk lamp that ended in `status`. */
const customer = async (email: string, status?: "pending_payment" | "delivered" | "refunded") => {
  const { accessToken } = await registerUser(harness, email);
  if (status !== undefined) {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [["desk-lamp", 1]], { token: accessToken }));
    if (status !== "pending_payment") {
      await Shop.succeed(harness, placed.charge);
      await harness.settle();
      await harness.database.sql`
        UPDATE customer_order SET status = ${status}, tracking_number = 'PR000000001EE' WHERE id = ${placed.orderId}`;
    }
  }
  return accessToken;
};

const call = (token: string | undefined, method: "GET" | "PUT" | "POST" | "DELETE", url: string, payload?: object) =>
  Shop.call(harness, method, url, token === undefined ? {} : { token }, payload);

const publicPage = async (query = ""): Promise<Page> =>
  jsonOf(await call(undefined, "GET", `/products/desk-lamp/reviews${query}`)) as unknown as Page;

const viewerOf = async (token: string): Promise<Viewer> =>
  jsonOf(await call(token, "GET", "/products/desk-lamp/reviews/viewer")) as unknown as Viewer;

const write = (token: string, body: object = review) => call(token, "PUT", "/products/desk-lamp/reviews/mine", body);

const approve = (reviewId: string) => Staff.call(harness, moderator, "POST", `/admin/reviews/${reviewId}/approve`);

/** A delivered customer's review, approved by the moderator. Resolves to its id and the author's token. */
const approvedReview = async (email: string, body: object = review) => {
  const token = await customer(email, "delivered");
  const id = String(jsonOf(await write(token, body))["id"]);
  await approve(id);
  return { id, token };
};

describe("who may review", () => {
  it.each([
    ["nobody without an order", undefined, false],
    ["nobody with an unpaid order", "pending_payment", false],
    ["a customer whose order was delivered", "delivered", true],
    ["nobody whose order was refunded", "refunded", false],
  ] as const)("allows %s", async (_label, status, allowed) => {
    const token = await customer("buyer@example.com", status);

    expect((await viewerOf(token)).canReview).toBe(allowed);
    const response = await write(token);
    expect(response.statusCode).toBe(allowed ? 200 : 403);
    if (!allowed) expect(jsonOf(response)["error"]).toMatchObject({ code: "ReviewNotAllowed" });
  });

  it("lets a customer who already reviewed edit the review rather than write a second", async () => {
    const token = await customer("buyer@example.com", "delivered");
    const first = jsonOf(await write(token));
    const second = jsonOf(await write(token, { ...review, rating: 2 }));

    expect(second).toMatchObject({ id: first["id"], rating: 2, status: "pending" });
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM product_review`).toEqual([{ n: 1 }]);
  });
});

describe("moderation", () => {
  it("keeps a new review from the public, and shows it to its author as waiting", async () => {
    const token = await customer("buyer@example.com", "delivered");
    await write(token);

    expect((await publicPage()).count).toBe(0);
    expect((await viewerOf(token)).own).toMatchObject({ status: "pending" });
  });

  it("publishes an approved review and counts it in the average", async () => {
    const { id } = await approvedReview("buyer@example.com", { ...review, rating: 2 });
    await approvedReview("other@example.com", { ...review, rating: 5 });

    const page = await publicPage();
    expect(page.items.map((item) => item.id)).toContain(id);
    expect(page).toMatchObject({ count: 2, average: 3.5 });

    const product = jsonOf(await call(undefined, "GET", "/products/desk-lamp"));
    expect(product["rating"]).toEqual({ average: 3.5, count: 2 });
  });

  it("shows the author why a review was rejected", async () => {
    const token = await customer("buyer@example.com", "delivered");
    const id = String(jsonOf(await write(token))["id"]);

    const rejected = await Staff.call(harness, moderator, "POST", `/admin/reviews/${id}/reject`, { reason: "Please leave out the link." });

    expect(rejected.statusCode).toBe(204);
    expect((await viewerOf(token)).own).toMatchObject({ status: "rejected", rejectionReason: "Please leave out the link." });
    expect((await publicPage()).count).toBe(0);
  });

  it("takes an edited review out of the average until it is approved again", async () => {
    const { id, token } = await approvedReview("buyer@example.com");
    expect((await publicPage()).count).toBe(1);

    await write(token, { ...review, rating: 1 });

    expect((await publicPage()).count).toBe(0);
    await approve(id);
    expect(await publicPage()).toMatchObject({ count: 1, average: 1 });
  });

  it("lets the author delete their review", async () => {
    const { token } = await approvedReview("buyer@example.com");

    expect((await call(token, "DELETE", "/products/desk-lamp/reviews/mine")).statusCode).toBe(204);
    expect((await publicPage()).count).toBe(0);
    expect((await call(token, "DELETE", "/products/desk-lamp/reviews/mine")).statusCode).toBe(404);
  });

  it("lists the queue for moderators, oldest first, and records each decision", async () => {
    const first = await customer("first@example.com", "delivered");
    await write(first);
    harness.clock.advanceSeconds(60);
    const second = await customer("second@example.com", "delivered");
    await write(second, { ...review, authorName: "Jaan" });

    const queue = jsonOf(await Staff.call(harness, moderator, "GET", "/admin/reviews"));
    const items = queue["items"] as { id: string; authorName: string; product: { slug: string } }[];
    expect(items.map((item) => [item.authorName, item.product.slug])).toEqual([
      ["Mari", "desk-lamp"],
      ["Jaan", "desk-lamp"],
    ]);

    await approve(items[0]?.id ?? "");
    await Staff.call(harness, moderator, "DELETE", `/admin/reviews/${items[1]?.id ?? ""}`);
    expect(await harness.database.sql`SELECT action FROM audit_event WHERE target_type = 'review' ORDER BY id`).toEqual([
      { action: "review.approve" },
      { action: "review.delete" },
    ]);
  });
});

describe("helpful votes", () => {
  it("count once per person, and can be taken back", async () => {
    const { id } = await approvedReview("author@example.com");
    const voter = await customer("voter@example.com");

    await call(voter, "PUT", `/reviews/${id}/vote`);
    await call(voter, "PUT", `/reviews/${id}/vote`);
    expect((await publicPage()).items[0]?.helpfulCount).toBe(1);
    expect((await viewerOf(voter)).votedReviewIds).toEqual([id]);

    await call(voter, "DELETE", `/reviews/${id}/vote`);
    expect((await publicPage()).items[0]?.helpfulCount).toBe(0);
  });

  it("refuses a vote on one's own review", async () => {
    const { id, token } = await approvedReview("author@example.com");

    const response = await call(token, "PUT", `/reviews/${id}/vote`);

    expect(response.statusCode).toBe(403);
    expect((await publicPage()).items[0]?.helpfulCount).toBe(0);
  });

  it("leaves a count that matches the votes when ten people vote at once", async () => {
    const { id } = await approvedReview("author@example.com");
    const voters = await Promise.all(Array.from({ length: 10 }, (_, index) => customer(`voter-${index}@example.com`)));

    const responses = await Promise.all(voters.map((voter) => call(voter, "PUT", `/reviews/${id}/vote`)));

    expect(responses.every((response) => response.statusCode === 204)).toBe(true);
    expect((await publicPage()).items[0]?.helpfulCount).toBe(10);
    expect(await harness.database.sql`SELECT count(*)::int AS n FROM review_vote`).toEqual([{ n: 10 }]);
  });
});

describe("the order of reviews", () => {
  it("sorts by helpfulness, newest first among ties, and by date and rating on request", async () => {
    const low = await approvedReview("low@example.com", { ...review, rating: 2, authorName: "Low" });
    harness.clock.advanceSeconds(60);
    await approvedReview("high@example.com", { ...review, rating: 5, authorName: "High" });
    harness.clock.advanceSeconds(60);
    await approvedReview("mid@example.com", { ...review, rating: 4, authorName: "Mid" });
    await call(await customer("voter@example.com"), "PUT", `/reviews/${low.id}/vote`);

    const names = async (sort: string) => (await publicPage(`?sort=${sort}`)).items.map((item) => item.authorName);

    expect(await names("helpful")).toEqual(["Low", "Mid", "High"]);
    expect(await names("newest")).toEqual(["Mid", "High", "Low"]);
    expect(await names("highest")).toEqual(["High", "Mid", "Low"]);
    expect(await names("lowest")).toEqual(["Low", "Mid", "High"]);
  });

  it("adds the distribution up to the count", async () => {
    await seedCatalog(harness, [{ slug: "lamp-2", name: "Lamp Two", priceCents: 1000, ratings: [5, 5, 4, 2, 1, 5] }]);

    const page = jsonOf(await call(undefined, "GET", "/products/lamp-2/reviews")) as unknown as Page;

    expect(page.distribution).toEqual({ "1": 1, "2": 1, "3": 0, "4": 1, "5": 3 });
    expect(Object.values(page.distribution).reduce((sum, count) => sum + count, 0)).toBe(page.count);
  });
});

describe("validation", () => {
  it.each([
    ["a rating of 0", { ...review, rating: 0 }, "rating"],
    ["a rating of 6", { ...review, rating: 6 }, "rating"],
    ["a rating of 2.5", { ...review, rating: 2.5 }, "rating"],
    ["a 121-character title", { ...review, title: "t".repeat(121) }, "title"],
    ["an empty byline", { ...review, authorName: "" }, "authorName"],
  ])("refuses %s", async (_label, body, path) => {
    const token = await customer("buyer@example.com", "delivered");

    const response = await write(token, body);

    expect(response.statusCode).toBe(422);
    expect(jsonOf(response)["error"]).toMatchObject({ issues: [{ path }] });
  });

  it("treats an empty title and body as none", async () => {
    const token = await customer("buyer@example.com", "delivered");

    const saved = jsonOf(await write(token, { rating: 5, authorName: "Mari", title: "  ", body: "" }));

    expect(saved).not.toHaveProperty("title");
    expect(saved).not.toHaveProperty("body");
  });
});

describe("who changes a review", () => {
  it("is its author alone: another customer's routes touch only their own", async () => {
    const { id } = await approvedReview("author@example.com");
    const intruder = await customer("intruder@example.com", "delivered");
    const author = await userIdOf(harness, "author@example.com");

    expect((await call(intruder, "DELETE", "/products/desk-lamp/reviews/mine")).statusCode).toBe(404);
    await write(intruder, { ...review, body: "Overwritten?" });

    const [stored] = await harness.database.sql`SELECT body, user_id FROM product_review WHERE id = ${id}`;
    expect(stored).toEqual({ body: review.body, user_id: author });
  });
});
