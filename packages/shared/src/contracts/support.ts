/** The contact form. Nothing it sends is stored: it becomes two emails. */

import { z } from "zod";
import { CaptchaToken, Email } from "./auth.ts";
import { OptionalText } from "./reviews.ts";

/** What a message is about, which routes it inside the support inbox. */
export type SupportTopic = (typeof SupportTopic.NAMES)[number];
export const SupportTopic = {
  NAMES: ["order", "payment", "shipping", "returns", "account", "other"] as const,
  schema: z.enum(["order", "payment", "shipping", "returns", "account", "other"], { error: "Choose a topic." }),
  label: {
    order: "An order",
    payment: "A payment",
    shipping: "Shipping and delivery",
    returns: "Returns and refunds",
    account: "My account",
    other: "Something else",
  } as const satisfies Record<"order" | "payment" | "shipping" | "returns" | "account" | "other", string>,
} as const;

/** A validated `POST /support/messages` body. */
export type SupportMessageInput = z.infer<typeof SupportMessageInput.schema>;
export const SupportMessageInput = {
  schema: z.strictObject({
    name: z.string({ error: "Enter your name." }).trim().min(2, "Enter your name.").max(100, "Use at most 100 characters."),
    email: Email.schema,
    topic: SupportTopic.schema,
    /** The order the message is about, when it is about one. */
    orderNumber: OptionalText.of(12, "Use at most 12 characters.").pipe(
      z.string().regex(/^#?\d{6,10}$/, "Enter the order number, such as 100123.").optional(),
    ),
    message: z
      .string({ error: "Write your message." })
      .trim()
      .min(10, "Write at least 10 characters.")
      .max(2000, "Use at most 2,000 characters."),
    captchaToken: CaptchaToken.schema,
  }),
} as const;
