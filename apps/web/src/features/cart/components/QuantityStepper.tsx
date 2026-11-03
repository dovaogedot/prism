import { Quantity } from "@prism/shared"
import { useEffect, useState } from "react"
import { QuantityEntry } from "../quantity-entry.ts"

/** The quantity, how many the shop has, and what to call it for a screen reader. */
export type QuantityStepperProps = Readonly<{
  value: number
  /** How many the shop has. The field allows up to that many, or up to `value` when that is more. */
  stock: number
  onChange: (quantity: number) => void
  label: string
  disabled?: boolean
}>

/**
 * A minus button, a number field and a plus button, for a wrapping flex row.
 * Typing commits on blur or Enter. A number outside 1 to the ceiling is
 * brought to the nearer end, and anything else that is not a whole number
 * goes back to the last good value; either way a note says why, on a line of
 * its own under the row, and is read out.
 */
export const QuantityStepper = ({ value, stock, onChange, label, disabled = false }: QuantityStepperProps) => {
  const [draft, setDraft] = useState(String(value))

  const [note, setNote] = useState<string | undefined>(undefined)

  useEffect(() => setDraft(String(value)), [value])

  const ceiling = QuantityEntry.findCeiling(value, stock)

  const commit = (): void => {
    const entry = QuantityEntry.read(draft, value, stock)
    setDraft(String(entry.quantity))
    setNote(entry.note)
    if (entry.quantity !== value) onChange(entry.quantity)
  }

  const step = (quantity: number): void => {
    setNote(undefined)
    onChange(quantity)
  }

  const button = "grid h-full w-9 place-items-center text-ink-soft transition-colors hover:bg-sunken hover:text-ink disabled:opacity-40"

  return (
    <>
      {/* h-10: as tall as a button and a field beside it. */}
      <div className="inline-flex h-10 items-stretch overflow-hidden rounded-lg border border-edge bg-surface">
        <button
          type="button"
          aria-label={`One fewer ${label}`}
          disabled={disabled || value <= Quantity.MIN}
          onClick={() => step(value - 1)}
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
          onChange={(event) => {
            setDraft(event.target.value)
            setNote(undefined)
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit()
          }}
          className="w-11 border-x border-edge bg-surface text-center text-sm tabular-nums text-ink [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`One more ${label}`}
          disabled={disabled || value >= ceiling}
          onClick={() => step(value + 1)}
          className={button}
        >
          +
        </button>
      </div>

      {/* Last in the row and a line to itself, so no control beside the
          stepper moves when it shows. With nothing to say it takes no room
          and stays a live region, so the next note is read out. */}
      <p className={note === undefined ? "sr-only" : "order-last basis-full text-sm font-medium text-warn"} role="status">
        {note}
      </p>
    </>
  )
}
