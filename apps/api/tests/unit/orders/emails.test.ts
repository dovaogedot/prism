import { Contact, OrderId, OrderKey, OrderNumber, ShippingAddress, ShippingMethodCode, Slug } from "@prism/shared";
import { describe, expect, it } from "vitest";
import { Html } from "../../../src/http/html.ts";
import { OrderEmail } from "../../../src/modules/orders/emails.ts";
import type { OrderRecord } from "../../../src/modules/orders/repository.ts";

const hostile = `<img src=x onerror="alert('pwned')">`;

const order: OrderRecord = {
  id: OrderId.schema.parse("6f1c2a52-3b8e-4f43-9a6e-1c2d3e4f5a6b"),
  number: OrderNumber.schema.parse(100001),
  status: "payment_successful",
  shippingMethod: ShippingMethodCode.schema.parse("standard"),
  shippingMethodName: "Standard",
  estimatedDelivery: { from: "2026-08-11", to: "2026-08-13" },
  subtotalCents: 5000,
  shippingCents: 0,
  totalCents: 5000,
  contact: Contact.schema.parse({ fullName: `Mari ${hostile}`, email: "mari@example.com", phone: "+37251234567" }),
  address: ShippingAddress.schema.parse({ line1: "Narva mnt 7", city: "Tallinn", postalCode: "10117", country: "EE" }),
  key: OrderKey.schema.parse("A".repeat(43)),
  paymentDueAt: new Date("2026-08-07T12:30:00Z"),
  createdAt: new Date("2026-08-07T12:00:00Z"),
  lines: [
    {
      slug: Slug.schema.parse("lamp"),
      name: hostile,
      unitPriceCents: 2500,
      quantity: 2,
      lineTotalCents: 5000,
    },
  ],
};

const url = OrderEmail.urlOf("https://shop.example.com", order);

const emails = {
  confirmed: OrderEmail.confirmed(order, url),
  paymentFailed: OrderEmail.paymentFailed(order, url, "insufficient_funds"),
  canceled: OrderEmail.canceled(order, url, "You canceled this order."),
  refunded: OrderEmail.refunded(order, url),
  shipped: OrderEmail.shipped(order, url, "PR123456789EE"),
};

describe("Html.escape", () => {
  it("neutralizes every character that could open markup or close an attribute", () => {
    expect(Html.escape(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("order emails", () => {
  it.each(Object.entries(emails))("%s escapes the product and customer names in its HTML", (_name, email) => {
    expect(email.html).not.toContain("<img");
    expect(email.html).not.toContain(`onerror="`);
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(&#39;pwned&#39;)&quot;&gt;");
  });

  it.each(Object.entries(emails))("%s goes to the order's contact and links to the order with its key", (_name, email) => {
    expect(email.to).toBe("mari@example.com");
    expect(email.text).toContain(`https://shop.example.com/orders/${order.id}?key=${"A".repeat(43)}`);
    expect(email.text).toContain("€50.00");
  });

  it("links a signed-in customer's order without a key", () => {
    const { key: _key, ...owned } = order;
    expect(OrderEmail.urlOf("https://shop.example.com", owned)).toBe(`https://shop.example.com/orders/${order.id}`);
  });

  it("names the reason a payment failed", () => {
    expect(emails.paymentFailed.text).toContain("Your card has insufficient funds.");
  });

  it("carries the tracking number of a shipped order", () => {
    expect(emails.shipped.text).toContain("PR123456789EE");
  });
});
