/**
 * Checkout's pure parts: the empty form and the prefilled one, which server
 * issues land on which field, what a Stripe error tells the customer, and
 * the one Stripe.js instance.
 */

import {
  DeclineCodes,
  PaymentFailure,
  type CheckoutForm,
  type CheckoutPrefill,
  type PaymentsConfig,
  type PlaceOrderInput,
  type ValidationIssue,
} from "@prism/shared";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import type { UseFormReturn } from "react-hook-form";
import { Api } from "../../shared/api/client.ts";

/** The checkout form as its sections share it: what is typed in, and what validation hands on. */
export type CheckoutFormApi = UseFormReturn<CheckoutForm, unknown, Omit<PlaceOrderInput, "expectedTotalCents">>;

/** The fields of a Stripe.js error the page reads. */
export type StripeFailure = Readonly<{ type: string; code?: string; decline_code?: string; message?: string }>;

export const PaymentErrors = {
  /** The sentence for a payment request that never reached Stripe. */
  OFFLINE: "We could not reach the payment provider. Check your connection and try again. You have not been charged.",

  /**
   * One sentence for a Stripe.js error. Stripe's own field checks already
   * read well, so they are shown as they are; a decline is explained in the
   * shop's words, the same ones the failure email uses.
   */
  messageOf: (error: StripeFailure): string => {
    if (error.type === "validation_error") return error.message ?? "Check the card details.";
    if (error.type === "api_connection_error") return PaymentErrors.OFFLINE;

    if (error.type === "card_error" || error.code === "payment_intent_authentication_failure") {
      return PaymentFailure.message[DeclineCodes.failureOf(error.decline_code, error.code)];
    }

    return PaymentFailure.message.gateway_error;
  },
} as const;

/** A form path the checkout renders a field for. */
export type CheckoutField = (typeof CheckoutField.PATHS)[number];
export const CheckoutField = {
  /** Every path a server issue can name that has a field on the page. */
  PATHS: [
    "contact.fullName",
    "contact.email",
    "contact.phone",
    "address.line1",
    "address.line2",
    "address.city",
    "address.postalCode",
    "address.country",
    "shippingMethod",
  ] as const,
} as const;

export const CheckoutIssues = {
  /** Server issues split into those a field shows and those the page shows above the form. */
  split: (
    issues: readonly ValidationIssue[],
  ): Readonly<{ fields: readonly Readonly<{ path: CheckoutField; message: string }>[]; other: readonly ValidationIssue[] }> => {
    const fields: { path: CheckoutField; message: string }[] = [];
    const other: ValidationIssue[] = [];

    for (const issue of issues) {
      const field = CheckoutField.PATHS.find((candidate) => candidate === issue.path);

      if (field === undefined) other.push(issue);
      else fields.push({ path: field, message: issue.message });
    }

    return { fields, other };
  },
} as const;

export const CheckoutDefaults = {
  /** The form before anyone typed, shipping to the first country on the list. */
  empty: (): CheckoutForm => ({
    contact: { fullName: "", email: "", phone: "" },
    address: { line1: "", line2: "", city: "", postalCode: "", country: "EE" },
    shippingMethod: "standard",
  }),

  /** The form a signed-in customer starts with: the account email, and the last order's details. */
  fromPrefill: (prefill: CheckoutPrefill): CheckoutForm => {
    const empty = CheckoutDefaults.empty();

    return {
      contact: prefill.contact ?? { ...empty.contact, email: prefill.email },
      address: prefill.address === undefined ? empty.address : { ...prefill.address, line2: prefill.address.line2 ?? "" },
      shippingMethod: prefill.shippingMethod ?? empty.shippingMethod,
    };
  },
} as const;

export const StripeLoader = {
  /** Stripe.js once per publishable key, so a second visit to checkout reuses the first load. */
  loaded: new Map<string, Promise<Stripe | null>>(),

  /** Stripe.js, loaded from js.stripe.com and never bundled. */
  load: (publishableKey: string): Promise<Stripe | null> => {
    const existing = StripeLoader.loaded.get(publishableKey);
    if (existing !== undefined) return existing;

    const loading = loadStripe(publishableKey);
    StripeLoader.loaded.set(publishableKey, loading);
    return loading;
  },

  /** Stripe's fields drawn in the shop's colors and corners, in either theme. */
  appearance: (dark: boolean) => ({
    theme: dark ? ("night" as const) : ("stripe" as const),
    variables: {
      colorPrimary: dark ? "#f0c43c" : "#2563eb",
      borderRadius: "8px",
      fontFamily: "Inter var, ui-sans-serif, system-ui, sans-serif",
    },
  }),
} as const;

/** Whether payments are on, and Stripe's publishable key if they are. */
export const usePaymentsConfig = () =>
  useQuery({
    queryKey: ["checkout", "config"],
    queryFn: ({ signal }) => Api.get<PaymentsConfig>("/checkout/config", signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
