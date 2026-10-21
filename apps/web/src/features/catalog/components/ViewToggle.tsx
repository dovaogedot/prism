import type { ListingView } from "../listing.ts";

/** The view in force, and what choosing one does. */
export type ViewToggleProps = Readonly<{ view: ListingView; onChange: (view: ListingView) => void }>;

/** Two pressed-or-not buttons: the results as a grid of cards, or as a list of rows. */
export const ViewToggle = ({ view, onChange }: ViewToggleProps) => {
  const buttonClass = "grid size-9 place-items-center rounded-md transition-colors";
  const stateClass = (isOn: boolean) => (isOn ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink");

  return (
    <div className="flex shrink-0 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="View">
      <button className={`${buttonClass} ${stateClass(view === "grid")}`} type="button" aria-pressed={view === "grid"} aria-label="Grid" onClick={() => onChange("grid")}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
        </svg>
      </button>
      <button className={`${buttonClass} ${stateClass(view === "list")}`} type="button" aria-pressed={view === "list"} aria-label="List" onClick={() => onChange("list")}>
        <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.5" cy="6" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="18" r="1" />
        </svg>
      </button>
    </div>
  );
};
