import { useEffect, useId, useRef, type ReactNode } from "react";

/** Whether the dialog shows, what it is called, and what closing it does. */
export type DialogProps = Readonly<{
  isOpen: boolean;
  title: string;
  /** Called when the dialog closes by itself: Escape, or its own close button. */
  onClose: () => void;
  /** Room for a picture rather than a question. */
  isWide?: boolean;
  children: ReactNode;
}>;

/**
 * A modal dialog on the native `<dialog>`. The browser makes the page behind
 * it inert, closes it on Escape, and gives focus back to whatever had it
 * before it opened. Focus starts on the control marked `data-autofocus`,
 * else on the first one.
 */
export const Dialog = ({ isOpen, title, onClose, isWide = false, children }: DialogProps) => {
  const dialog = useRef<HTMLDialogElement>(null);

  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;

    if (isOpen && !element.open) {
      element.showModal();
      // A dialog may name the control focus starts on; otherwise the browser picks the first one.
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!isOpen && element.open) {
      element.close();
    }
  }, [isOpen]);

  return (
    <dialog
      className={`${isWide ? "w-[min(64rem,calc(100vw-2rem))]" : "w-[min(28rem,calc(100vw-2rem))]"} m-auto rounded-lg border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40`}
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
    >
      <div className="space-y-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold" id={titleId}>
            {title}
          </h2>
          <button
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-sunken hover:text-ink"
            type="button"
            aria-label="Close"
            onClick={() => dialog.current?.close()}
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
};
