import { Link } from "react-router";

/** The foot of every page: what the shop is, its fixed pages, and where else to find it. */
export const Footer = () => {
  const linkClass = "text-sm text-ink-soft hover:text-ink hover:underline";

  return (
    <footer className="border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1fr_auto_auto] md:gap-16">
        <div className="max-w-xs space-y-2">
          <p className="font-semibold text-ink">Prism</p>
          <p className="text-sm text-ink-soft">Collectible pixel-art game items, delivered across Europe.</p>
        </div>

        <nav aria-label="About the shop">
          <h2 className="mb-2 text-sm font-semibold text-ink">The shop</h2>
          <ul className="space-y-1.5">
            <li>
              <Link className={linkClass} to="/about">
                About us
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/contact">
                Contact
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/faq">
                FAQ
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/terms">
                Terms of service
              </Link>
            </li>
            <li>
              <Link className={linkClass} to="/privacy">
                Privacy policy
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="Elsewhere">
          <h2 className="mb-2 text-sm font-semibold text-ink">Follow us</h2>
          <ul className="space-y-1.5">
            <li>
              <a className={linkClass} href="https://github.com/dovaogedot/prism">
                GitHub
              </a>
            </li>
            <li>
              <a className={linkClass} href="https://www.instagram.com/">
                Instagram
              </a>
            </li>
            <li>
              <a className={linkClass} href="https://x.com/">
                X
              </a>
            </li>
            <li>
              <a className={linkClass} href="https://www.youtube.com/">
                YouTube
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <p className="mx-auto max-w-7xl border-t border-line px-4 py-5 text-sm text-ink-faint sm:px-6">© {new Date().getFullYear()} Prism</p>
    </footer>
  );
};
