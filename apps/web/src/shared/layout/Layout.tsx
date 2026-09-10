import { Link, Outlet, useNavigate } from "react-router";
import { match } from "ts-pattern";
import { useSession, useSignOut } from "../../features/auth/session.ts";
import { useRendering } from "../render/use-rendering.ts";
import { useTheme } from "../theme/use-theme.ts";

const ThemeToggle = () => {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
    >
      {match(theme)
        .with("dark", () => (
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
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
          <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </svg>
        ))
        .exhaustive()}
    </button>
  );
};

const RenderToggle = () => {
  const { rendering, toggle } = useRendering();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${rendering ? "still" : "live"} pictures`}
      className="grid size-9 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
    >
      {match(rendering)
        .with(true, () => (
          <svg
            viewBox="0 0 24 24"
            className="size-5"
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
            className="size-5"
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
    </button>
  );
};

const Wordmark = () => (
  <Link to="/" className="flex items-center gap-2.5">
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

/** The header and footer every page sits between. */
export const Layout = () => {
  const session = useSession();
  const signOut = useSignOut();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          {/*
            No nav beside it. The shop is the only destination, and the
            wordmark already goes there — a "Shop" link next to it was a second
            button for the same place.
          */}
          <Wordmark />

          <div className="flex-1" />

          <RenderToggle />

          <ThemeToggle />

          {match(session)
            .with({ _tag: "Some" }, ({ value }) => (
              <div className="flex items-center gap-1">
                <Link
                  to="/account"
                  className="hidden max-w-[13rem] truncate rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink sm:block"
                >
                  {value.email}
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    void signOut().then(() => navigate("/"));
                  }}
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink"
                >
                  Sign out
                </button>
              </div>
            ))
            .with({ _tag: "None" }, () => (
              <div className="flex items-center gap-1">
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft hover:bg-sunken hover:text-ink"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
                >
                  Create account
                </Link>
              </div>
            ))
            .exhaustive()}
        </div>
      </header>

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
  );
};
