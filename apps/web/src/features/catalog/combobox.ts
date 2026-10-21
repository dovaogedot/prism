/**
 * The keyboard of the header's search box, as the ARIA 1.2 combobox pattern
 * defines it: the arrows move through the suggestions and wrap around,
 * Enter opens the active one or searches for the text, and Escape closes
 * the list, or clears the box when the list is already closed.
 */

/** Whether the list shows, and which option is active: the one Enter opens. */
export type ComboboxState = Readonly<{ isOpen: boolean; active?: number }>;

/** What a key does beyond moving through the list. */
export type ComboboxAction =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "choose"; index: number }>
  | Readonly<{ kind: "submit" }>
  | Readonly<{ kind: "clear" }>;

/** A key's outcome: the state after it, what it does, and whether the browser's own handling of it stops. */
export type ComboboxStep = Readonly<{ state: ComboboxState; action: ComboboxAction; isHandled: boolean }>;

export const Combobox = {
  CLOSED: { isOpen: false } satisfies ComboboxState,
  OPEN: { isOpen: true } satisfies ComboboxState,

  /** What `key` does in `state` when the list holds `optionCount` options. */
  key: (state: ComboboxState, key: string, optionCount: number): ComboboxStep => {
    const none: ComboboxAction = { kind: "none" };

    switch (key) {
      case "ArrowDown": {
        if (optionCount === 0) return { state, action: none, isHandled: false };

        const active = state.isOpen && state.active !== undefined ? (state.active + 1) % optionCount : 0;
        return { state: { isOpen: true, active }, action: none, isHandled: true };
      }
      case "ArrowUp": {
        if (optionCount === 0) return { state, action: none, isHandled: false };

        const active = state.isOpen && state.active !== undefined ? (state.active - 1 + optionCount) % optionCount : optionCount - 1;
        return { state: { isOpen: true, active }, action: none, isHandled: true };
      }
      case "Enter": {
        const action: ComboboxAction =
          state.isOpen && state.active !== undefined && state.active < optionCount ? { kind: "choose", index: state.active } : { kind: "submit" };
        return { state: Combobox.CLOSED, action, isHandled: true };
      }
      case "Escape":
        return state.isOpen
          ? { state: Combobox.CLOSED, action: none, isHandled: true }
          : { state, action: { kind: "clear" }, isHandled: true };
      case "Tab":
        return { state: Combobox.CLOSED, action: none, isHandled: false };
      default:
        return { state, action: none, isHandled: false };
    }
  },

  /** `state` with an active option that no longer exists let go. */
  clamp: (state: ComboboxState, optionCount: number): ComboboxState =>
    state.active === undefined || state.active < optionCount ? state : { isOpen: state.isOpen },

  /** Whether a key press landed where typing a slash means a slash, rather than the search shortcut. */
  isTyping: (target: EventTarget | null): boolean =>
    target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)),
} as const;
