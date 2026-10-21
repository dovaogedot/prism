import { useSyncExternalStore } from "react";
import { Toast } from "./toast.ts";

/**
 * Draws the messages `Toast.show` puts up, at the bottom of the screen. The
 * list is a polite live region, so each new message is read out once.
 */
export const Toaster = () => {
  const shown = useSyncExternalStore(Toast.subscribe, Toast.snapshot);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
      {shown.map((toast) => (
        <div
          className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-lg border px-4 py-3 text-sm shadow-lg ${
            toast.tone === "danger" ? "border-danger/30 bg-danger-wash text-ink" : "border-line bg-surface text-ink"
          }`}
          key={toast.id}
        >
          <span>{toast.text}</span>
          <button className="shrink-0 rounded text-ink-soft hover:text-ink" type="button" aria-label="Dismiss" onClick={() => Toast.dismiss(toast.id)}>
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
};
