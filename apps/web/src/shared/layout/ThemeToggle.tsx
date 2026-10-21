import { match } from "ts-pattern";
import { useTheme } from "../theme/use-theme.ts";
import { LookClass, type Look } from "./look.ts";

/** Whether the switch sits in the header bar or in the drawer. */
export type ThemeToggleProps = Readonly<{ look: Look }>;

/** Switches between the light and the dark theme. A row prints what it does; an icon carries it for a screen reader. */
export const ThemeToggle = ({ look }: ThemeToggleProps) => {
  const { theme, toggle } = useTheme();

  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;

  return (
    <button className={LookClass[look]} type="button" onClick={toggle} aria-label={look === "icon" ? label : undefined}>
      {match(theme)
        .with("dark", () => (
          <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
          <svg className="size-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
          </svg>
        ))
        .exhaustive()}
      {look === "row" ? <span>{label}</span> : null}
    </button>
  );
};
