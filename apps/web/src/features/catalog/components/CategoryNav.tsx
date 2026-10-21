import { Link } from "react-router";

/** One choice of the row: its name, where it goes, whether it is the one in force, and how many items it holds. */
export type CategoryLink = Readonly<{ label: string; href: string; isCurrent: boolean; count?: number }>;

/** The choices of the row. */
export type CategoryNavProps = Readonly<{ links: readonly CategoryLink[] }>;

/** A row of links to the shop's categories, the one in force marked for the eye and for a screen reader. */
export const CategoryNav = ({ links }: CategoryNavProps) => (
  <nav className="mb-6" aria-label="Categories">
    <ul className="flex flex-wrap gap-2">
      {links.map((link) => (
        <li key={link.href}>
          <Link
            className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
              link.isCurrent ? "border-accent bg-accent-wash font-semibold text-ink" : "border-line bg-surface text-ink-soft hover:border-line-strong hover:text-ink"
            }`}
            to={link.href}
            aria-current={link.isCurrent ? "page" : undefined}
          >
            {link.label}
            {link.count === undefined ? null : <span className="text-xs tabular-nums text-ink-faint">{link.count}</span>}
          </Link>
        </li>
      ))}
    </ul>
  </nav>
);
