import { Link } from "react-router";
import { PageText } from "../../../shared/seo/page-text.ts";
import { FixedPage } from "../components/FixedPage.tsx";

/** What Prism keeps about a person, why, and how it is protected. */
export const PrivacyPage = () => (
  <FixedPage text={PageText.privacy} lede="What we keep about you, why we keep it, and how we protect it.">
    <h2>What we keep</h2>
    <ul>
      <li>
        <strong>Your account:</strong> your email address, a hash of your password, your name and phone number if you add them,
        your saved addresses, and the secret of your two-factor sign-in if you turn it on.
      </li>
      <li>
        <strong>Your orders:</strong> the contact details, shipping and billing addresses, items, totals and payment reference of
        each order.
      </li>
      <li>
        <strong>Your reviews:</strong> what you write, your rating, and the name you choose to show with it.
      </li>
      <li>
        <strong>Your sessions:</strong> the browser and network address you signed in from, so we can spot and stop someone else
        using your account.
      </li>
    </ul>
    <p>
      We never see your card number: it goes straight from your browser to Stripe. Messages from the contact form are emailed to
      our support team and not stored in the shop.
    </p>

    <h2>Why we keep it</h2>
    <p>
      To deliver your orders, to let you sign in safely, to answer your questions, and to keep the records accounting law requires.
      We do not sell your data, and we do not use it for advertising.
    </p>

    <h2>How we protect it</h2>
    <ul>
      <li>Every connection to the shop is encrypted with TLS.</li>
      <li>
        Everything in our database that identifies you, from your email to your addresses, is encrypted with AES-256. Without the
        key, which is kept apart from the database, a copy of the database tells nobody who you are.
      </li>
      <li>Passwords are stored only as argon2 hashes, which cannot be turned back into the password.</li>
      <li>Staff who can see orders must sign in with a second factor, and every change they make is recorded.</li>
    </ul>

    <h2>Who else handles it</h2>
    <p>
      Stripe processes payments. Our email provider delivers the messages we send you. Google's reCAPTCHA checks that the person
      registering or writing to us is human, and sees your address and browser to do so.
    </p>

    <h2>Cookies and storage</h2>
    <p>
      We use two cookies, both needed for the shop to work: one keeps you signed in and one keeps your cart. Your browser also
      remembers your theme and the items you viewed recently; that stays on your device. There are no tracking or advertising
      cookies.
    </p>

    <h2>How long we keep it</h2>
    <p>
      Your account stays until you ask us to delete it. Orders are kept for seven years, as Estonian accounting law requires.
      Sessions end when you sign out or after a week without use.
    </p>

    <h2>Your rights</h2>
    <p>
      You can ask for a copy of your data, ask us to correct or delete it, or object to how we use it. Write to us through the{" "}
      <Link to="/contact">contact form</Link>, and you can also complain to the Estonian Data Protection Inspectorate.
    </p>
  </FixedPage>
);
