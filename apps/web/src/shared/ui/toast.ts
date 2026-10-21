/**
 * Short messages about something that just happened, such as a saved change.
 * Any code can show one; the `Toaster` in the layout draws them and a
 * screen reader reads each one out.
 */

/** How a message reads: a success, or a failure. */
export type ToastTone = "success" | "danger";

/** One message on screen. */
export type Toast = Readonly<{ id: number; text: string; tone: ToastTone }>;

/** The messages on screen, the next id, and who draws them. */
const ToastState: { shown: readonly Toast[]; nextId: number; readonly listeners: Set<() => void> } = {
  shown: [],
  nextId: 1,
  listeners: new Set(),
};

export const Toast = {
  /** How long a message stays. */
  DURATION_MS: 6000,
  /** The most messages on screen at once; an older one makes way. */
  MAX_SHOWN: 3,

  /** Shows `text` for a few seconds. */
  show: (text: string, tone: ToastTone = "success"): void => {
    const id = ToastState.nextId;
    ToastState.nextId += 1;
    ToastState.shown = [...ToastState.shown, { id, text, tone }].slice(-Toast.MAX_SHOWN);
    Toast.announce();
    window.setTimeout(() => Toast.dismiss(id), Toast.DURATION_MS);
  },

  dismiss: (id: number): void => {
    ToastState.shown = ToastState.shown.filter((toast) => toast.id !== id);
    Toast.announce();
  },

  subscribe: (listener: () => void): (() => void) => {
    ToastState.listeners.add(listener);
    return () => ToastState.listeners.delete(listener);
  },

  /** The messages on screen; a new array whenever they change, as `useSyncExternalStore` needs. */
  snapshot: (): readonly Toast[] => ToastState.shown,

  announce: (): void => {
    for (const listener of ToastState.listeners) listener();
  },
} as const;
