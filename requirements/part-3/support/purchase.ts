/**
 * Buying through the API as a requirement check describes it: an order paid
 * through the payment provider's webhook, and taken by staff from paid to
 * delivered, the way a customer's order reaches the point where its products
 * can be reviewed or refunded.
 */

import { Shop, type Caller } from "../../../apps/api/tests/support/commerce.ts"
import { jsonOf, registerUser, type Harness } from "../../../apps/api/tests/support/harness.ts"
import { Staff, type TestAccount } from "../../../apps/api/tests/support/staff.ts"

export const Purchase = {
  /** Places an order of one `slug` as `caller`, and has the provider confirm the payment. Resolves to the order's id and guest key. */
  placePaid: async (harness: Harness, caller: Caller, slug: string) => {
    const placed = await Shop.placed(harness, await Shop.fill(harness, [[slug, 1]], caller))
    await Shop.succeed(harness, placed.charge)
    await harness.settle()

    return placed
  },

  /** Moves a paid order through processing and shipped to delivered as `staff`, and fails the test if a step is refused. */
  deliver: async (harness: Harness, staff: TestAccount, orderId: string): Promise<void> => {
    for (const step of [{ status: "processing" }, { status: "shipped", trackingNumber: "PR123456789EE" }, { status: "delivered" }]) {
      const response = await Staff.call(harness, staff, "POST", `/admin/orders/${orderId}/status`, step)

      if (response.statusCode !== 200) {
        throw new Error(`moving the order to ${step.status} failed: ${response.body}`)
      }
    }

    await harness.settle()
  },

  /** Registers `email`, buys one `slug`, and has `staff` deliver it. Resolves to the customer's access token. */
  deliverTo: async (harness: Harness, staff: TestAccount, email: string, slug: string): Promise<string> => {
    const { accessToken } = await registerUser(harness, email)
    const placed = await Purchase.placePaid(harness, { token: accessToken }, slug)
    await Purchase.deliver(harness, staff, placed.orderId)

    return accessToken
  },

  /** Writes `review` of `slug` as the customer with `token`, and has `moderator` approve it. Resolves to the review's id. */
  publishReview: async (harness: Harness, moderator: TestAccount, token: string, slug: string, review: object): Promise<string> => {
    const written = await Shop.call(harness, "PUT", `/products/${slug}/reviews/mine`, { token }, review)

    if (written.statusCode !== 200) {
      throw new Error(`writing the review failed: ${written.body}`)
    }

    const id = String(jsonOf(written)["id"])
    const approved = await Staff.call(harness, moderator, "POST", `/admin/reviews/${id}/approve`)

    if (approved.statusCode !== 204) {
      throw new Error(`approving the review failed: ${approved.body}`)
    }

    return id
  },
} as const
