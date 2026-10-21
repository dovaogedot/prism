import { NavLink } from "react-router";

/** The account's own pages, the one in view marked for the eye and for a screen reader. */
export const AccountNav = () => {
  const linkClass = ({ isActive }: Readonly<{ isActive: boolean }>) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${isActive ? "bg-accent-wash text-ink" : "text-ink-soft hover:bg-sunken hover:text-ink"}`;

  return (
    <nav aria-label="Account">
      <ul className="flex flex-wrap gap-1">
        <li>
          <NavLink className={linkClass} to="/account" end>
            Profile
          </NavLink>
        </li>
        <li>
          <NavLink className={linkClass} to="/account/addresses">
            Addresses
          </NavLink>
        </li>
        <li>
          <NavLink className={linkClass} to="/account/orders">
            Orders
          </NavLink>
        </li>
      </ul>
    </nav>
  );
};
