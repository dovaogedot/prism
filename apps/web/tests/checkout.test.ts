import { Email, PaymentFailure, ShippingMethodCode } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { CheckoutDefaults, CheckoutIssues, PaymentErrors } from "../src/features/checkout/checkout.ts";

describe("PaymentErrors.messageOf", () => {
  it("shows Stripe's own sentence for a field it checked before submission", () => {
    expect(PaymentErrors.messageOf({ type: "validation_error", code: "incomplete_number", message: "Your card number is incomplete." })).toBe(
      "Your card number is incomplete.",
    );
  });

  it("explains each decline in the shop's words", () => {
    const cases = [
      [{ code: "card_declined", decline_code: "insufficient_funds" }, "insufficient_funds"],
      [{ code: "expired_card" }, "expired_card"],
      [{ code: "incorrect_cvc" }, "incorrect_cvc"],
      [{ code: "incorrect_number" }, "incorrect_number"],
      [{ code: "card_declined", decline_code: "generic_decline" }, "card_declined"],
    ] as const;

    for (const [fields, failure] of cases) {
      expect(PaymentErrors.messageOf({ type: "card_error", ...fields }), failure).toBe(PaymentFailure.message[failure]);
    }
  });

  it("explains a failed 3D Secure check", () => {
    expect(PaymentErrors.messageOf({ type: "invalid_request_error", code: "payment_intent_authentication_failure" })).toBe(
      PaymentFailure.message.authentication_failed,
    );
  });

  it("calls a lost connection a network problem, with no charge made", () => {
    expect(PaymentErrors.messageOf({ type: "api_connection_error" })).toBe(PaymentErrors.OFFLINE);
    expect(PaymentErrors.OFFLINE).toContain("You have not been charged.");
  });

  it("calls anything else a provider problem", () => {
    expect(PaymentErrors.messageOf({ type: "api_error" })).toBe(PaymentFailure.message.gateway_error);
  });
});

describe("CheckoutIssues.split", () => {
  it("puts each issue on its field, and keeps the rest for the page", () => {
    expect(
      CheckoutIssues.split([
        { path: "contact.email", message: "Enter a valid email address." },
        { path: "address.line1", message: "We could not find this address." },
        { path: "", message: "Something else." },
        { path: "expectedTotalCents", message: "Invalid." },
      ]),
    ).toEqual({
      fields: [
        { path: "contact.email", message: "Enter a valid email address." },
        { path: "address.line1", message: "We could not find this address." },
      ],
      other: [
        { path: "", message: "Something else." },
        { path: "expectedTotalCents", message: "Invalid." },
      ],
    });
  });
});

describe("CheckoutDefaults.fromPrefill", () => {
  const email = Email.schema.parse("buyer@example.com");
  const standard = { code: ShippingMethodCode.schema.parse("standard"), name: "Standard", priceCents: 490, minDays: 2, maxDays: 4 };
  const express = { code: ShippingMethodCode.schema.parse("express"), name: "Express", priceCents: 990, minDays: 1, maxDays: 2 };

  it("starts a first-time customer with the account email and the first option", () => {
    expect(CheckoutDefaults.fromPrefill({ email }, [standard, express])).toEqual({
      ...CheckoutDefaults.empty(standard.code),
      contact: { fullName: "", email: "buyer@example.com", phone: "" },
    });
  });

  it("starts a returning customer with the last order's details", () => {
    const contact = { fullName: "Mari Maasikas", email, phone: "+37251234567" };
    const address = { line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" as const };

    expect(CheckoutDefaults.fromPrefill({ email, contact, address, shippingMethod: express.code }, [standard, express])).toEqual({
      contact,
      address: { ...address, line2: "" },
      shippingMethod: "express",
    });
  });

  it("falls back to the first option when the last order's method is no longer offered", () => {
    expect(CheckoutDefaults.fromPrefill({ email, shippingMethod: express.code }, [standard]).shippingMethod).toBe("standard");
  });
});
