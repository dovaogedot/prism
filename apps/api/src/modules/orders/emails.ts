/**
 * Order emails as pure functions: an order in, a message out, nothing sent.
 * Product names and the customer's name are data, so every interpolated
 * value is escaped before it reaches the HTML body.
 */

import { OrderStatus, PaymentFailure, Price, type OrderNumber } from "@prism/shared";
import { Html } from "../../http/html.ts";
import type { OutboundEmail } from "../../platform/mailer.ts";
import type { OrderRecord } from "./repository.ts";

/** The parts every order email shares. */
type Letter = Readonly<{
  subject: string;
  heading: string;
  /** Plain sentences, escaped when rendered. */
  paragraphs: readonly string[];
  order: OrderRecord;
  orderUrl: string;
}>;

export const OrderEmail = {
  /** The order page, with the key a guest needs to open it. */
  urlOf: (webOrigin: string, order: OrderRecord): string =>
    order.key === undefined ? `${webOrigin}/orders/${order.id}` : `${webOrigin}/orders/${order.id}?key=${order.key}`,

  numberOf: (number: OrderNumber): string => `#${number}`,

  /** The lines and totals as plain text. */
  summaryText: (order: OrderRecord): readonly string[] => [
    ...order.lines.map((line) => `${line.quantity} × ${line.name}  ${Price.format(line.lineTotalCents)}`),
    "",
    `Subtotal  ${Price.format(order.subtotalCents)}`,
    `Shipping  ${order.shippingCents === 0 ? "Free" : Price.format(order.shippingCents)}`,
    `Total     ${Price.format(order.totalCents)}`,
  ],

  /** The lines and totals as rows of flexboxes. */
  summaryHtml: (order: OrderRecord): string => {
    const row = (label: string, amount: string, strong: boolean): string =>
      `<div style="display:flex;justify-content:space-between;gap:16px;padding:6px 0;${strong ? "font-weight:700;" : ""}">` +
      `<span>${Html.escape(label)}</span><span>${Html.escape(amount)}</span></div>`;

    return [
      `<div style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;padding:8px 0;margin:0 0 12px">`,
      ...order.lines.map((line) => row(`${line.quantity} × ${line.name}`, Price.format(line.lineTotalCents), false)),
      `</div>`,
      row("Subtotal", Price.format(order.subtotalCents), false),
      row("Shipping", order.shippingCents === 0 ? "Free" : Price.format(order.shippingCents), false),
      row("Total", Price.format(order.totalCents), true),
    ].join("\n");
  },

  compose: (letter: Letter): OutboundEmail => ({
    to: letter.order.contact.email,
    subject: letter.subject,
    text: [
      letter.heading,
      "",
      ...letter.paragraphs,
      "",
      ...OrderEmail.summaryText(letter.order),
      "",
      `See your order: ${letter.orderUrl}`,
    ].join("\n"),
    html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Prism · Order ${Html.escape(OrderEmail.numberOf(letter.order.number))}</p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3">${Html.escape(letter.heading)}</h1>
      ${letter.paragraphs.map((paragraph) => `<p style="margin:0 0 16px;line-height:1.6;color:#334155">${Html.escape(paragraph)}</p>`).join("\n      ")}
      ${OrderEmail.summaryHtml(letter.order)}
      <a href="${Html.escape(letter.orderUrl)}"
         style="display:inline-block;margin-top:16px;background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">
        View your order
      </a>
    </div>
  </body>
</html>`,
  }),

  /** The payment went through: the order confirmation. */
  confirmed: (order: OrderRecord, orderUrl: string): OutboundEmail =>
    OrderEmail.compose({
      subject: `Order ${OrderEmail.numberOf(order.number)} confirmed`,
      heading: "Thank you for your order",
      paragraphs: [
        `Hi ${order.contact.fullName}, we received your payment and your order is confirmed.`,
        "We will email you again when it ships.",
      ],
      order,
      orderUrl,
    }),

  /** The payment did not go through. */
  paymentFailed: (order: OrderRecord, orderUrl: string, failure: PaymentFailure | undefined): OutboundEmail =>
    OrderEmail.compose({
      subject: `Payment for order ${OrderEmail.numberOf(order.number)} failed`,
      heading: "Your payment did not go through",
      paragraphs: [
        failure === undefined ? "The payment could not be completed." : PaymentFailure.message[failure],
        "You have not been charged. Your cart still holds these items, so you can try again with another card.",
      ],
      order,
      orderUrl,
    }),

  /** The order was canceled, by the customer or because it was never paid. */
  canceled: (order: OrderRecord, orderUrl: string, reason: string): OutboundEmail =>
    OrderEmail.compose({
      subject: `Order ${OrderEmail.numberOf(order.number)} canceled`,
      heading: "Your order was canceled",
      paragraphs: [reason, "If you paid for it, the refund follows in a separate email."],
      order,
      orderUrl,
    }),

  /** The payment went back to the customer. */
  refunded: (order: OrderRecord, orderUrl: string): OutboundEmail =>
    OrderEmail.compose({
      subject: `Refund for order ${OrderEmail.numberOf(order.number)}`,
      heading: "Your refund is on its way",
      paragraphs: [
        `We refunded ${Price.format(order.totalCents)} to the card you paid with.`,
        "Banks usually show it within 5 to 10 business days.",
      ],
      order,
      orderUrl,
    }),

  /** The parcel left the warehouse. */
  shipped: (order: OrderRecord, orderUrl: string, trackingNumber: string): OutboundEmail =>
    OrderEmail.compose({
      subject: `Order ${OrderEmail.numberOf(order.number)} shipped`,
      heading: "Your order is on its way",
      paragraphs: [
        `Your order is ${OrderStatus.label.shipped.toLowerCase()}. The tracking number is ${trackingNumber}.`,
      ],
      order,
      orderUrl,
    }),
} as const;
