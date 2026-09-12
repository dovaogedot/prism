import { Option } from "@prism/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";
import { match } from "ts-pattern";
import { useSession, useSignOut } from "../../features/auth/session.ts";
import { useRendering } from "../render/use-rendering.ts";
import { useTheme } from "../theme/use-theme.ts";
import { type Drawer, DrawerContext } from "./drawer.ts";
import { useWide } from "./use-wide.ts";

/** How a switch is drawn: as an icon in the header, or as a row in the drawer. */
type Look = "icon" | "row";

const LOOKS: Record<Look, string> = {
  icon: "grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
  row: "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm font-medium text-ink-soft transition-colors hover:bg-sunken hover:text-ink",
};

/**
 * The name a switch is read by, as props.
 *
 * An icon has no text, so it carries its name for a screen reader. A row
 * prints its name, and the printed text is the name.
 */
const nameOf = (look: Look, label: string): Readonly<{ "aria-label"?: string }> =>
  match(look)
    .with("icon", () => ({ "aria-label": label }))
    .with("row", () => ({}))
    .exhaustive();

/** A row's printed name. An icon prints nothing. */
const Caption = ({ look, label }: Readonly<{ look: Look; label: string }>) =>
  match(look)
    .with("icon", () => null)
    .with("row", () => <span>{label}</span>)
    .exhaustive();

const ThemeToggle = ({ look }: Readonly<{ look: Look }>) => {
  const { theme, toggle } = useTheme();
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;

  return (
    <button type="button" onClick={toggle} {...nameOf(look, label)} className={LOOKS[look]}>
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

/** The switch between live and still pictures, where this browser can draw live ones. */
const RenderToggle = ({ look }: Readonly<{ look: Look }>) => {
  const { rendering, offered, toggle } = useRendering();
  const label = `Switch to ${rendering ? "still" : "live"} pictures`;

  return match(offered)
    .with(false, () => null)
    .with(true, () => (
      <button type="button" onClick={toggle} {...nameOf(look, label)} className={LOOKS[look]}>
        {match(rendering)
          .with(true, () => (
            <svg
              viewBox="0 0 24 24"
              className="size-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              <rect x="3.2" y="5.2" width="17.6" height="13.6" rx="2.2" />
              <circle cx="8.6" cy="10.1" r="1.5" />
              <path d="m3.9 16.6 4.4-4.1 3.4 3 3.1-2.7 5.3 4.7" strokeLinecap="round" />
            </svg>
          ))
          .with(false, () => (
            <svg
              viewBox="0 0 24 24"
              className="size-5 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            >
              <path d="M12 2.4 20.6 7.2v9.6L12 21.6 3.4 16.8V7.2z" />
              <path d="M3.4 7.2 12 12l8.6-4.8M12 12v9.6" />
            </svg>
          ))
          .exhaustive()}
        <Caption look={look} label={label} />
      </button>
    ))
    .exhaustive();
};

const Wordmark = () => (
  <Link to="/" className="flex shrink-0 items-center gap-2.5">
    <span
      aria-hidden="true"
      className="size-7 rounded-full"
      style={{
        // The two theme accents, in the logo.
        backgroundImage:
          "conic-gradient(from 140deg, var(--color-accent), oklch(70% .19 25), oklch(85% .17 92), oklch(65% .18 155), var(--color-accent))",
      }}
    />
    <span className="text-[15px] font-semibold tracking-tight text-ink">
      Prism
    </span>
  </Link>
);

/**
 * The header and footer every page sits between, and the drawer a narrow page
 * keeps its switches and signing out in.
 *
 * Every page under it can put its own part of the drawer in through
 * `useDrawer`. The drawer closes when the page widens past the width it is for
 * and when the shopper goes to another page.
 */
export const Layout = () => {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const wide = useWide();
  const dialog = useRef<HTMLDialogElement>(null);
  const [slot, setSlot] = useState<Option<HTMLElement>>(Option.none);

  // One identity for the whole life of the layout, so React calls it when the
  // slot mounts and unmounts rather than on every render.
  const holdSlot = useCallback((node: HTMLDivElement | null) => {
    setSlot(Option.fromNullable(node));
  }, []);

  const open = useCallback(() => {
    Option.match<HTMLDialogElement, void>({
      onSome: (drawer) => {
        if (!drawer.open) drawer.showModal();
      },
      onNone: () => undefined,
    })(Option.fromNullable(dialog.current));
  }, []);

  const close = useCallback(() => {
    Option.match<HTMLDialogElement, void>({
      onSome: (drawer) => drawer.close(),
      onNone: () => undefined,
    })(Option.fromNullable(dialog.current));
  }, []);

  useEffect(close, [wide, pathname, close]);

  const leave = (): void => {
    void signOut().then(() => navigate("/"));
  };

  const drawer: Drawer = useMemo(() => ({ slot, open }), [slot, open]);

  return (
    <DrawerContext value={drawer}>
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
              className={`${LOOKS.icon} lg:hidden`}
            >
              <svg
                viewBox="0 0 24 24"
                className="size-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <path d="M4 7h16M4 12h16M4 17h16" />
              </svg>
            </button>

            {/*
              No nav beside it. The shop is the only destination, and the
              wordmark already goes there — a "Shop" link next to it was a second
              button for the same place.
            */}
            <Wordmark />

            <div className="flex-1" />

            <div className="hidden items-center gap-4 lg:flex">
              <RenderToggle look="icon" />
              <ThemeToggle look="icon" />
            </div>

            {match(session)
              .with({ _tag: "Some" }, ({ value }) => (
                <div className="flex shrink-0 items-center gap-1">
                  {/*
                    A narrow page has no room for the address, so the account
                    is an icon there and signing out is in the drawer.
                  */}
                  <Link to="/account" aria-label="Your account" className={`${LOOKS.icon} lg:hidden`}>
                    <svg
                      viewBox="0 0 24 24"
                      className="size-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="8.5" r="3.8" />
                      <path d="M4.5 20.5c1.2-3.6 4.1-5.6 7.5-5.6s6.3 2 7.5 5.6" />
                    </svg>
                  </Link>
                  <Link
                    to="/account"
                    className="hidden max-w-[13rem] truncate rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:block"
                  >
                    {value.email}
                  </Link>
                  <button
                    type="button"
                    onClick={leave}
                    className="hidden whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink lg:block"
                  >
                    Sign out
                  </button>
                </div>
              ))
              .with({ _tag: "None" }, () => (
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
              .exhaustive()}
          </div>
        </header>

        <dialog
          ref={dialog}
          aria-label="Menu"
          className="drawer"
          // The content fills the dialog, so a click that lands on the dialog
          // itself is a click on the backdrop around it.
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold text-ink">Menu</span>
              <button
                type="button"
                onClick={close}
                aria-label="Close menu"
                className={LOOKS.icon}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
              <div className="space-y-1 border-b border-line pb-4">
                <RenderToggle look="row" />
                <ThemeToggle look="row" />
              </div>

              <div ref={holdSlot} />
            </div>

            {/* Held at the foot of the drawer, however long what is above it runs. */}
            {match(session)
              .with({ _tag: "Some" }, () => (
                <div className="border-t border-line p-4">
                  <button
                    type="button"
                    onClick={() => {
                      close();
                      leave();
                    }}
                    className={LOOKS.row}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="size-5 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M14.5 4.5h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h9.5" />
                    </svg>
                    <span>Sign out</span>
                  </button>
                </div>
              ))
              .with({ _tag: "None" }, () => null)
              .exhaustive()}
          </div>
        </dialog>

        <main id="main" className="flex-1">
          <Outlet />
        </main>

        <footer className="border-t border-line py-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 text-sm text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p>
              Prism — we sell colors. Not paint.{" "}
              <span className="text-ink-faint/70">Colors.</span>
            </p>
            <a href="/api/docs" className="hover:text-ink hover:underline">
              API documentation
            </a>
          </div>
        </footer>
      </div>
    </DrawerContext>
  );
};
