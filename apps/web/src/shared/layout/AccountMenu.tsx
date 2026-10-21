import { useId } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useSession, useSignOut } from "../../features/auth/session.ts";
import { Popover } from "../ui/index.ts";
import { LookClass } from "./look.ts";

/**
 * The header's account control. A guest gets the way to sign in, which
 * comes back to the current page, and to open an account. A signed-in
 * customer gets a menu of their orders, account and addresses, the admin
 * for staff, and signing out.
 */
export const AccountMenu = () => {
  const session = useSession();

  const signOut = useSignOut();

  const navigate = useNavigate();

  const { pathname, search } = useLocation();

  const panelId = useId();

  if (session === undefined) {
    const signIn = `/login?next=${encodeURIComponent(`${pathname}${search}`)}`;

    return (
      <div className="flex shrink-0 items-center gap-1">
        <Link className={`${LookClass.icon} lg:hidden`} to={signIn} aria-label="Sign in">
          <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="8.5" r="3.8" />
            <path d="M4.5 20.5c1.2-3.6 4.1-5.6 7.5-5.6s6.3 2 7.5 5.6" />
          </svg>
        </Link>
        <Link className="hidden whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:block" to={signIn}>
          Sign in
        </Link>
        <Link
          className="hidden whitespace-nowrap rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover lg:block"
          to="/register"
        >
          Create account
        </Link>
      </div>
    );
  }

  const itemClass = "block rounded-md px-3 py-2 text-sm text-ink hover:bg-sunken";

  return (
    <>
      <button
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:px-3"
        type="button"
        popoverTarget={panelId}
        aria-label={`Account, ${session.email}`}
      >
        <svg className="size-5 lg:hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="8.5" r="3.8" />
          <path d="M4.5 20.5c1.2-3.6 4.1-5.6 7.5-5.6s6.3 2 7.5 5.6" />
        </svg>
        <span className="hidden max-w-[13rem] truncate lg:block">{session.email}</span>
        <svg className="hidden size-4 lg:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <Popover id={panelId} side="end" label="Your account">
        <p className="truncate border-b border-line px-5 py-3 text-sm text-ink-soft">{session.email}</p>
        <ul className="p-2">
          <li>
            <Link className={itemClass} to="/account/orders">
              Orders
            </Link>
          </li>
          <li>
            <Link className={itemClass} to="/account">
              Account
            </Link>
          </li>
          <li>
            <Link className={itemClass} to="/account/addresses">
              Addresses
            </Link>
          </li>
          {session.roles.length === 0 ? null : (
            <li>
              <Link className={itemClass} to="/admin">
                Admin
              </Link>
            </li>
          )}
        </ul>
        <div className="border-t border-line p-2">
          <button
            className={`${itemClass} w-full text-left`}
            type="button"
            onClick={() => {
              void signOut().then(() => navigate("/"));
            }}
          >
            Sign out
          </button>
        </div>
      </Popover>
    </>
  );
};
