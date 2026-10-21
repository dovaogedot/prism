import { Button } from "./Button.tsx";

/** Where the reader is, how far it goes, and what turning a page does. */
export type PaginationProps = Readonly<{
  page: number;
  totalPages: number;
  /** Names the navigation, so two on one page differ. */
  label?: string;
  onPage: (page: number) => void;
}>;

/** Previous and next, around where the reader is. Nothing when everything fits on one page. */
export const Pagination = ({ page, totalPages, label = "Pages", onPage }: PaginationProps) =>
  totalPages <= 1 ? null : (
    <nav className="mt-6 flex items-center justify-center gap-3" aria-label={label}>
      <Button tone="quiet" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <span className="text-sm tabular-nums text-ink-soft">
        Page {page} of {totalPages}
      </span>
      <Button tone="quiet" type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </nav>
  );
