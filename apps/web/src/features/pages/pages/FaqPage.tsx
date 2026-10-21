import { Price, ShippingOption } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { PageText } from "../../../shared/seo/page-text.ts";
import { useShippingOptions } from "../../checkout/checkout.ts";
import { FixedPage } from "../components/FixedPage.tsx";

/** Common questions about shipping, payment and returns. The delivery options come from the shop's own settings. */
export const FaqPage = () => {
  const shipping = useShippingOptions();

  return (
    <FixedPage text={PageText.faq} lede="Shipping, payment and returns, answered. Anything else, ask us through the contact form.">
      <h2>Shipping and delivery</h2>

      <details open>
        <summary>Which delivery options are there, and what do they cost?</summary>
        {match(shipping)
          .with({ status: "pending" }, () => <p>Loading the delivery options…</p>)
          .with({ status: "error" }, () => <p>The delivery options could not load. Checkout lists them with their prices too.</p>)
          .with({ data: P.select() }, (options) => (
            <ul>
              {options.map((option) => (
                <li key={option.code}>
                  <strong>{option.name}</strong>: {Price.format(option.priceCents)}, arriving in {ShippingOption.windowOf(option)}
                  {option.freeFromCents === undefined ? "." : `, and free for orders of ${Price.format(option.freeFromCents)} or more.`}
                </li>
              ))}
            </ul>
          ))
          .exhaustive()}
      </details>

      <details>
        <summary>When will my order arrive?</summary>
        <p>
          Checkout shows the delivery dates of each option before you pay, counted in business days from the day you order. Your
          order page keeps those dates, and its status changes as the order moves from processing to shipped and delivered.
        </p>
      </details>

      <details>
        <summary>How do I track my order?</summary>
        <p>
          Once your order ships, its page shows the carrier's tracking number, and we email you. Signed-in customers find every order
          under <Link to="/account/orders">Orders</Link>; a guest opens the order from the link in the confirmation email.
        </p>
      </details>

      <details>
        <summary>Where do you deliver?</summary>
        <p>To addresses across the European Union. Checkout lists every country we deliver to.</p>
      </details>

      <h2>Payment</h2>

      <details>
        <summary>How can I pay?</summary>
        <p>
          By card. The card fields come from Stripe, our payment provider, so your card number goes straight to Stripe and never
          reaches our servers.
        </p>
      </details>

      <details>
        <summary>When is my card charged?</summary>
        <p>When you place the order. If the payment fails, the order waits for a new attempt and nothing is shipped.</p>
      </details>

      <details>
        <summary>Can I cancel an order?</summary>
        <p>
          Yes, until we start processing it: open the order and choose Cancel. A paid order that is canceled is refunded in full to
          the card it was paid with.
        </p>
      </details>

      <h2>Returns and refunds</h2>

      <details>
        <summary>Can I return an item?</summary>
        <p>
          Yes, within 14 days of delivery, for any reason. Write to us through the <Link to="/contact">contact form</Link> with your
          order number, and we will tell you where to send it.
        </p>
      </details>

      <details>
        <summary>How long does a refund take?</summary>
        <p>
          We refund the whole order to the card it was paid with as soon as the return arrives. Your bank usually shows the money
          within 5 to 10 business days, and your order page shows it as refunded.
        </p>
      </details>
    </FixedPage>
  );
};
