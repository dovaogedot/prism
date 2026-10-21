import { Link } from "react-router";
import { PageText } from "../../../shared/seo/page-text.ts";
import { FixedPage } from "../components/FixedPage.tsx";

/** The terms every order is placed under. */
export const TermsPage = () => (
  <FixedPage text={PageText.terms} lede="The rules for shopping at Prism, in plain words. Placing an order means you accept them.">
    <h2>Who we are</h2>
    <p>Prism is an online shop based in Tallinn, Estonia. You can reach us at any time through the <Link to="/contact">contact form</Link>.</p>

    <h2>Orders and prices</h2>
    <p>
      Prices are in euros and include VAT. The price you pay is the one checkout shows when you place the order; if a price
      changes while you check out, checkout tells you before charging anything. An order is a contract once its payment succeeds,
      and we confirm it by email.
    </p>

    <h2>Payment</h2>
    <p>
      You pay by card through Stripe when you place the order. If an item turns out to be out of stock after all, we cancel that
      order and refund it in full.
    </p>

    <h2>Delivery</h2>
    <p>
      We deliver within the European Union by the option you choose at checkout. Delivery dates are estimates in business days;
      we tell you by email if an order will be late.
    </p>

    <h2>Cancellation, returns and refunds</h2>
    <ul>
      <li>You can cancel an order on its page until we start processing it.</li>
      <li>You can return any item within 14 days of delivery, without giving a reason, as EU law allows.</li>
      <li>We refund a canceled or returned order in full, to the card it was paid with, within 14 days.</li>
    </ul>

    <h2>Reviews</h2>
    <p>
      You can review an item once it is delivered to you. A moderator reads every review before it appears, and we refuse reviews
      that are abusive, off topic or that share someone's personal data. We never edit what you write.
    </p>

    <h2>Your account</h2>
    <p>
      Keep your password to yourself, and turn on two-factor sign-in for extra safety. You are responsible for orders placed from
      your account. We may close an account that is used for fraud or abuse.
    </p>

    <h2>Liability</h2>
    <p>
      We answer for the items we sell as consumer law requires, including the two-year legal guarantee. We are not liable for
      delays caused by events outside our control.
    </p>

    <h2>Changes to these terms</h2>
    <p>An order is always governed by the terms in force on the day it was placed. These terms are governed by Estonian law.</p>
  </FixedPage>
);
