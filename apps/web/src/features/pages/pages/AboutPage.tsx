import { Link } from "react-router";
import { PageText } from "../../../shared/seo/page-text.ts";
import { FixedPage } from "../components/FixedPage.tsx";

/** Who runs Prism, what it is for, and where else to find it. */
export const AboutPage = () => {
  const team = [
    { name: "Kadri Tamm", role: "Founder and buyer", initials: "KT", about: "Picks every item we sell, and plays far too much Balatro to call it research." },
    { name: "Marten Kask", role: "Engineering", initials: "MK", about: "Builds and runs the shop, from the search box to the encrypted database behind it." },
    { name: "Liis Saar", role: "Customer support", initials: "LS", about: "Answers every message that reaches the contact form, usually the same day." },
    { name: "Joonas Mets", role: "Fulfillment", initials: "JM", about: "Packs and ships the orders, and adds the tracking number you see on yours." },
  ];

  return (
    <FixedPage text={PageText.about} heading="About Prism" lede="A small shop for collectible pixel-art items from the games we love.">
      <h2>What we do</h2>
      <p>
        Prism sells collectible items from Minecraft, Balatro and The Binding of Isaac: swords and blocks, jokers and tarot cards,
        trinkets and passive items, each drawn pixel by pixel. We started in Tallinn with a few dozen items and a spreadsheet, and
        the catalog now holds thousands, each with its own page, photos and reviews from the people who bought it.
      </p>

      <h2>What we care about</h2>
      <ul>
        <li>
          <strong>Honest listings.</strong> Every item shows its real price, its stock and what it measures. Reviews come only from
          customers who received the item, and a moderator reads each one before it appears.
        </li>
        <li>
          <strong>Your data, kept safe.</strong> Everything that identifies you is encrypted in our database. The{" "}
          <Link to="/privacy">privacy policy</Link> says what we keep and why.
        </li>
        <li>
          <strong>A shop for everyone.</strong> Every page works with a keyboard and a screen reader, in light and in dark, on a
          phone as well as on a desktop.
        </li>
      </ul>

      <h2>The team</h2>
      <ul className="!list-none !pl-0 grid gap-4 sm:grid-cols-2">
        {team.map((person) => (
          <li className="!mt-0 flex gap-4 rounded-lg border border-line bg-surface p-4" key={person.name}>
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-wash font-semibold text-ink" aria-hidden="true">
              {person.initials}
            </span>
            <div>
              <h3 className="!mt-0 !mb-0">{person.name}</h3>
              <p className="text-sm">{person.role}</p>
              <p className="!mt-2 text-sm">{person.about}</p>
            </div>
          </li>
        ))}
      </ul>

      <h2>Find us</h2>
      <p>
        The shop's code is open on <a href="https://github.com/dovaogedot/prism">GitHub</a>. We also post new arrivals on{" "}
        <a href="https://www.instagram.com/">Instagram</a>, <a href="https://x.com/">X</a> and{" "}
        <a href="https://www.youtube.com/">YouTube</a>. For anything about an order, the <Link to="/contact">contact form</Link>{" "}
        reaches us fastest.
      </p>
    </FixedPage>
  );
};
