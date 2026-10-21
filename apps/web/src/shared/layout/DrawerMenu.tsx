import { Link, useNavigate } from "react-router";
import { useSession, useSignOut } from "../../features/auth/session.ts";
import { useCategories } from "../../features/catalog/catalog.ts";
import { LookClass } from "./look.ts";
import { ThemeToggle } from "./ThemeToggle.tsx";

/** What signing out from the drawer does first: close it. */
export type DrawerMenuProps = Readonly<{ onClose: () => void }>;

/** What the header holds, as rows for a narrow page: the theme, the categories and the account. */
export const DrawerMenu = ({ onClose }: DrawerMenuProps) => {
  const session = useSession();

  const signOut = useSignOut();

  const navigate = useNavigate();

  const categories = useCategories();

  const headingClass = "px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-faint";

  return (
    <div className="space-y-5">
      <div className="border-b border-line pb-4">
        <ThemeToggle look="row" />
      </div>

      <nav aria-label="Shop by category">
        <p className={headingClass}>Shop</p>
        <ul>
          <li>
            <Link className={LookClass.row} to="/shop">
              All products
            </Link>
          </li>
          {(categories.data ?? []).map((category) => (
            <li key={category.slug}>
              <Link className={LookClass.row} to={`/categories/${category.slug}`}>
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Your account">
        <p className={headingClass}>Account</p>
        {session === undefined ? (
          <ul>
            <li>
              <Link className={LookClass.row} to="/login">
                Sign in
              </Link>
            </li>
            <li>
              <Link className={LookClass.row} to="/register">
                Create account
              </Link>
            </li>
          </ul>
        ) : (
          <ul>
            <li>
              <Link className={LookClass.row} to="/account/orders">
                Orders
              </Link>
            </li>
            <li>
              <Link className={LookClass.row} to="/account">
                Account
              </Link>
            </li>
            <li>
              <Link className={LookClass.row} to="/account/addresses">
                Addresses
              </Link>
            </li>
            {session.roles.length === 0 ? null : (
              <li>
                <Link className={LookClass.row} to="/admin">
                  Admin
                </Link>
              </li>
            )}
            <li>
              <button
                className={LookClass.row}
                type="button"
                onClick={() => {
                  onClose();
                  void signOut().then(() => navigate("/"));
                }}
              >
                Sign out
              </button>
            </li>
          </ul>
        )}
      </nav>
    </div>
  );
};
