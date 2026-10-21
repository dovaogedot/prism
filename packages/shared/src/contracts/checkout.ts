/**
 * The checkout form and what placing an order answers. The same schemas
 * validate the form in the browser and the body on the server, so every
 * field message is written for a person.
 */

import { z } from "zod";
import { Email } from "./auth.ts";

/** A country the shop ships to, with the shape of its postal codes. */
export type Country = (typeof Country.CODES)[number];
export const Country = {
  CODES: ["EE", "LV", "LT", "FI", "SE", "DE", "FR", "NL", "PL"] as const,
  schema: z.enum(["EE", "LV", "LT", "FI", "SE", "DE", "FR", "NL", "PL"], { error: "Choose a country." }),
  name: {
    EE: "Estonia",
    LV: "Latvia",
    LT: "Lithuania",
    FI: "Finland",
    SE: "Sweden",
    DE: "Germany",
    FR: "France",
    NL: "Netherlands",
    PL: "Poland",
  } as const satisfies Record<"EE" | "LV" | "LT" | "FI" | "SE" | "DE" | "FR" | "NL" | "PL", string>,
  /** Postal codes as each country's post office writes them, after trimming and uppercasing. */
  postalCode: {
    EE: /^\d{5}$/,
    LV: /^(LV-)?\d{4}$/,
    LT: /^(LT-)?\d{5}$/,
    FI: /^\d{5}$/,
    SE: /^\d{3} ?\d{2}$/,
    DE: /^\d{5}$/,
    FR: /^\d{5}$/,
    NL: /^\d{4} ?[A-Z]{2}$/,
    PL: /^\d{2}-\d{3}$/,
  } as const satisfies Record<"EE" | "LV" | "LT" | "FI" | "SE" | "DE" | "FR" | "NL" | "PL", RegExp>,
  /** One valid postal code per country, for the field message. */
  postalCodeExample: {
    EE: "10111",
    LV: "LV-1050",
    LT: "LT-01103",
    FI: "00100",
    SE: "111 22",
    DE: "10115",
    FR: "75001",
    NL: "1012 AB",
    PL: "00-950",
  } as const satisfies Record<"EE" | "LV" | "LT" | "FI" | "SE" | "DE" | "FR" | "NL" | "PL", string>,
} as const;

/** Who the order is for and how to reach them. */
export type Contact = z.infer<typeof Contact.schema>;
export const Contact = {
  schema: z.object({
    fullName: z
      .string()
      .trim()
      .min(2, "Enter your full name.")
      .max(100, "Use at most 100 characters."),
    email: Email.schema,
    phone: z
      .string()
      .trim()
      .min(1, "Enter a phone number.")
      // Spaces, dots, dashes and brackets are how people group the digits.
      .transform((phone) => phone.replace(/[\s().-]/g, ""))
      .pipe(z.string().regex(/^\+?\d{7,15}$/, "Enter a phone number like +372 5123 4567.")),
  }),
} as const;

/** Where the parcel goes. */
export type ShippingAddress = z.infer<typeof ShippingAddress.schema>;
export const ShippingAddress = {
  schema: z
    .object({
      line1: z
        .string()
        .trim()
        .min(3, "Enter the street and house number.")
        .max(120, "Use at most 120 characters."),
      /** An apartment or floor. A blank field is absent. */
      line2: z
        .string()
        .trim()
        .max(120, "Use at most 120 characters.")
        .transform((line) => (line.length === 0 ? undefined : line))
        .optional(),
      city: z.string().trim().min(1, "Enter the city.").max(80, "Use at most 80 characters."),
      postalCode: z.string().trim().toUpperCase().min(1, "Enter the postal code.").max(12, "Use at most 12 characters."),
      country: Country.schema,
    })
    .superRefine((address, context) => {
      if (!Country.postalCode[address.country].test(address.postalCode)) {
        context.addIssue({
          code: "custom",
          path: ["postalCode"],
          message: `Enter a postal code like ${Country.postalCodeExample[address.country]}.`,
        });
      }
    }),
} as const;

/** The code a delivery option is stored and chosen by. Only the schema makes one. */
export type ShippingMethodCode = z.infer<typeof ShippingMethodCode.schema>;
export const ShippingMethodCode = {
  schema: z
    .string({ error: "Choose a shipping method." })
    .trim()
    .min(1, "Choose a shipping method.")
    .max(40, "Use at most 40 characters.")
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, digits and single dashes.")
    .brand<"ShippingMethodCode">(),
} as const;

/** A delivery option as checkout offers it and an order is priced with. */
export type ShippingOption = Readonly<{
  code: ShippingMethodCode;
  name: string;
  priceCents: number;
  /** The subtotal from which it ships free; absent when it never does. */
  freeFromCents?: number;
  /** The delivery window in business days after the order day, both ends counted. */
  minDays: number;
  maxDays: number;
}>;

export const ShippingOption = {
  /** The delivery window in words, such as "2 to 4 business days". */
  windowOf: (option: Readonly<{ minDays: number; maxDays: number }>): string => {
    if (option.minDays === option.maxDays) {
      return `${option.minDays} business ${option.minDays === 1 ? "day" : "days"}`;
    }
    return `${option.minDays} to ${option.maxDays} business days`;
  },
} as const;

/**
 * A validated `POST /orders` body. The total is what the page showed, so a
 * price that changed in between is caught instead of charged. Unknown keys
 * are refused: no price, amount or card field can ride along.
 */
export type PlaceOrderInput = z.infer<typeof PlaceOrderInput.schema>;
export const PlaceOrderInput = {
  schema: z.strictObject({
    contact: Contact.schema,
    address: ShippingAddress.schema,
    /** Where the bill goes; absent when it goes to the shipping address. */
    billingAddress: ShippingAddress.schema.optional(),
    shippingMethod: ShippingMethodCode.schema,
    /** Saves the shipping address to the signed-in customer's account. */
    shouldSaveAddress: z.boolean().optional(),
    expectedTotalCents: z.number().int().min(0),
  }),
} as const;

/** The checkout form, which is the order body without the total the page adds at send time. */
export type CheckoutForm = z.input<typeof CheckoutForm.schema>;
export const CheckoutForm = {
  schema: PlaceOrderInput.schema.omit({ expectedTotalCents: true }),
} as const;

/**
 * What a signed-in customer's checkout form starts with: the profile's name
 * and phone, else the last order's contact; the default saved address, else
 * the last order's address; and the last order's delivery option. Each is
 * absent when neither source has it.
 */
export type CheckoutPrefill = Readonly<{
  email: Email;
  contact?: Contact;
  address?: ShippingAddress;
  shippingMethod?: ShippingMethodCode;
}>;

/**
 * Whether the browser can take a card, and with which key. `simulated`
 * takes no card: the server settles every payment itself, for test stacks.
 */
export type PaymentsConfig =
  | Readonly<{ provider: "stripe"; publishableKey: string }>
  | Readonly<{ provider: "simulated" }>
  | Readonly<{ provider: "unavailable" }>;

/** What `POST /checkout/address` found. `unavailable` means only the format was checked. */
export type AddressCheck = Readonly<{ status: "verified" | "not_found" | "unavailable" }>;
export const AddressCheck = {
  NOT_FOUND: "We could not find this address. Check the street, postal code and city.",
} as const;

/** Why a payment did not go through, as a code the browser and the emails both explain. */
export type PaymentFailure = (typeof PaymentFailure.CODES)[number];
export const PaymentFailure = {
  CODES: [
    "insufficient_funds",
    "card_declined",
    "expired_card",
    "incorrect_cvc",
    "incorrect_number",
    "processing_error",
    "authentication_failed",
    "gateway_timeout",
    "gateway_error",
  ] as const,
  schema: z.enum([
    "insufficient_funds",
    "card_declined",
    "expired_card",
    "incorrect_cvc",
    "incorrect_number",
    "processing_error",
    "authentication_failed",
    "gateway_timeout",
    "gateway_error",
  ]),
  message: {
    insufficient_funds: "Your card has insufficient funds. Try another card.",
    card_declined: "Your card was declined. Try another card or contact your bank.",
    expired_card: "Your card has expired. Check the expiry date or use another card.",
    incorrect_cvc: "The security code (CVC) is incorrect.",
    incorrect_number: "The card number is incorrect.",
    processing_error: "The card could not be processed. Try again in a moment.",
    authentication_failed: "Your bank could not confirm the payment. Try again or use another card.",
    gateway_timeout: "The payment provider did not answer. You have not been charged.",
    gateway_error: "The payment provider had a problem. You have not been charged.",
  } as const satisfies Record<
    | "insufficient_funds"
    | "card_declined"
    | "expired_card"
    | "incorrect_cvc"
    | "incorrect_number"
    | "processing_error"
    | "authentication_failed"
    | "gateway_timeout"
    | "gateway_error",
    string
  >,
} as const;

/** How a provider's error codes become a `PaymentFailure`, the same in the browser and on the server. */
export const DeclineCodes = {
  /**
   * The failure a decline code and an error code stand for. The decline code
   * is the more specific of the two, so it is tried first; an unknown card
   * error is a plain decline.
   */
  failureOf: (declineCode: string | undefined, code: string | undefined): PaymentFailure => {
    for (const candidate of [declineCode, code]) {
      const known = PaymentFailure.schema.safeParse(candidate);
      if (known.success) return known.data;
    }

    if (code === "payment_intent_authentication_failure") return "authentication_failed";

    return code === undefined ? "processing_error" : "card_declined";
  },
} as const;
