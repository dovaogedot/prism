import { Quantity } from "@prism/shared";
import { useEffect, useState } from "react";

/** The quantity, its ceiling, and what to call it for a screen reader. */
export type QuantityStepperProps = Readonly<{
  value: number;
  /** The most the shop allows: the stock, or the line limit, whichever is lower. */
  max: number;
  onChange: (quantity: number) => void;
  label: string;
  disabled?: boolean;
}>;

/**
 * A minus button, a number field and a plus button. Typing commits on blur
 * or Enter; a number outside 1 to `max` is brought to the nearest end, and
 * anything that is not a whole number goes back to the last good value.
 */
export const QuantityStepper = ({ value, max, onChange, label, disabled = false }: QuantityStepperProps) => {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const ceiling = Math.max(Quantity.MIN, Math.min(max, Quantity.MAX));

  const commit = (): void => {
    const typed = Number(draft);

    if (draft.trim().length === 0 || !Number.isInteger(typed)) {
      setDraft(String(value));
      return;
    }

    const allowed = Math.max(Quantity.MIN, Math.min(typed, ceiling));
    setDraft(String(allowed));
    if (allowed !== value) onChange(allowed);
  };

  const button =
    "grid size-8 place-items-center text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40";

  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-surface">
      <button
        type="button"
        aria-label={`One fewer ${label}`}
        disabled={disabled || value <= Quantity.MIN}
        onClick={() => onChange(value - 1)}
        className={button}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={Quantity.MIN}
        max={ceiling}
        aria-label={`Quantity of ${label}`}
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        className="h-8 w-11 border-x border-line bg-surface text-center text-sm tabular-nums text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        aria-label={`One more ${label}`}
        disabled={disabled || value >= ceiling}
        onClick={() => onChange(value + 1)}
        className={button}
      >
        +
      </button>
    </div>
  );
};
