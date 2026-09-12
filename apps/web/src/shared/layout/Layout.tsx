import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { match, P } from "ts-pattern";
import { useSession, useSignOut } from "../../features/auth/session.ts";
import { useTheme } from "../theme/use-theme.ts";
import { Drawer, type Drawer as DrawerHandle } from "./drawer.ts";
import { useWide } from "./use-wide.ts";

/** How a switch is drawn: as an icon in the header, or as a row in the drawer. */
type Look = "icon" | "row";

const Looks = {
  icon: "grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
  row: "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
} as const satisfies Record<Look, string>;

/** A row prints its name; an icon carries it for a screen reader instead. */
const Caption = ({ look, label }: Readonly<{ look: Look; label: string }>) =>
  match(look)
    .with("icon", () => null)
    .with("row", () => <span>{label}</span>)
    .exhaustive();

const ThemeToggle = ({ look }: Readonly<{ look: Look }>) => {
  const { theme, toggle } = useTheme();
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;

  return (
    <button type="button" onClick={toggle} aria-label={look === "icon" ? label : undefined} className={Looks[look]}>
      {match(theme)
        .with("dark", () => (
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor">
            <circle cx="12" cy="12" r="4.2" />
            <path
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"
            />
          </svg>
        ))
        .with("light", () => (
          <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="currentColor">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </svg>
        ))
        .exhaustive()}
      <Caption look={look} label={label} />
    </button>
  );
};

/**
 * The header and footer every page sits between, and the drawer a narrow page
 * keeps its theme switch and signing out in.
 *
 * Every page under it can put its own part of the drawer in through
 * `useDrawer`. The drawer closes when the page widens past the width it is
 * for and when the shopper goes to another page.
 */
export const Layout = () => {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const wide = useWide();
  const dialog = useRef<HTMLDialogElement>(null);
  const [slot, setSlot] = useState<HTMLElement | undefined>(undefined);

  // One identity for the whole life of the layout, so React calls it when the
  // slot mounts and unmounts rather than on every render.
  const holdSlot = useCallback((node: HTMLDivElement | null) => {
    setSlot(node === null ? undefined : node);
  }, []);

  const open = useCallback(() => {
    const drawer = dialog.current;
    if (drawer === null) return;

    // Opened again on its way out, it turns back from where it has got to.
    drawer.removeAttribute("data-closing");
    if (!drawer.open) drawer.showModal();
  }, []);

  const close = useCallback(() => {
    const drawer = dialog.current;
    if (drawer === null || !drawer.open || drawer.hasAttribute("data-closing")) return;

    // Slid out while still open, and closed once it is out. Reading the
    // animations settles the style, so the slide the attribute starts is
    // among them; with no slide to wait for, the drawer closes at once.
    drawer.setAttribute("data-closing", "");
    void Promise.allSettled(drawer.getAnimations().map((slide) => slide.finished)).then(() => {
      if (!drawer.hasAttribute("data-closing")) return;

      drawer.removeAttribute("data-closing");
      drawer.close();
    });
  }, []);

  useEffect(close, [wide, pathname, close]);

  const leave = (): void => {
    void signOut().then(() => navigate("/"));
  };

  const drawer: DrawerHandle = useMemo(() => ({ slot, open }), [slot, open]);

  return (
    <Drawer.Context value={drawer}>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
          <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:gap-4 sm:px-6">
            <button
              type="button"
              onClick={open}
              aria-label="Open menu"
              aria-haspopup="dialog"
              className={`${Looks.icon} lg:hidden`}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            <Link to="/" className="shrink-0 text-[15px] font-semibold tracking-tight text-ink">
              Prism
            </Link>

            <div className="flex-1" />

            <div className="hidden items-center gap-4 lg:flex">
              <ThemeToggle look="icon" />
            </div>

            {match(session)
              .with(P.nullish, () => (
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    to="/login"
                    className="whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink sm:px-3"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/register"
                    className="whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover sm:px-3.5"
                  >
                    Create account
                  </Link>
                </div>
              ))
              .otherwise((user) => (
                <div className="flex shrink-0 items-center gap-1">
                  {/* A narrow page has no room for the address, so the account is an icon there. */}
                  <Link to="/account" aria-label="Your account" className={`${Looks.icon} lg:hidden`}>
                    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <circle cx="12" cy="8.5" r="3.8" />
                      <path d="M4.5 20.5c1.2-3.6 4.1-5.6 7.5-5.6s6.3 2 7.5 5.6" />
                    </svg>
                  </Link>
                  <Link
                    to="/account"
                    className="hidden max-w-[13rem] truncate rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:block"
                  >
                    {user.email}
                  </Link>
                  <button
                    type="button"
                    onClick={leave}
                    className="hidden whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:block"
                  >
                    Sign out
                  </button>
                </div>
              ))}
          </div>
        </header>

        <dialog
          ref={dialog}
          aria-label="Menu"
          className="drawer"
          // The content fills the dialog, so a click on the dialog itself is a click on the backdrop.
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          // Escape slides it out too, rather than taking it off the screen.
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold text-ink">Menu</span>
              <button type="button" onClick={close} aria-label="Close menu" className={Looks.icon}>
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
              <div className="space-y-1 border-b border-line pb-4">
                <ThemeToggle look="row" />
              </div>

              <div ref={holdSlot} />
            </div>

            {match(session)
              .with(P.nullish, () => null)
              .otherwise(() => (
                <div className="border-t border-line p-4">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      leave();
                    }}
                    className={Looks.row}
                  >
                    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h9.5" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              ))}
          </div>
        </dialog>

        <main id="main" className="flex-1">
          <Outlet />
        </main>

        <footer className="border-t border-line py-8">
          <p className="mx-auto max-w-7xl px-4 text-sm text-ink-faint sm:px-6">Prism</p>
        </footer>
      </div>
    </Drawer.Context>
  );
};
