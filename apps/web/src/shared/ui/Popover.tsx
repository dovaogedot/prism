import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "react-router";

/** The panel's id, which edge it lines up with, and its content. */
export type PopoverProps = Readonly<{
  className?: string;
  /** What a `popoverTarget` button names to open it; unique on the page. */
  id: string;
  /** The side of the content column the panel lines up with. */
  side: "start" | "end";
  /** The panel's accessible name. */
  label: string;
  /** Told whenever the panel opens or closes. */
  onToggle?: (isOpen: boolean) => void;
  children: ReactNode;
}>;

/**
 * A panel the header opens with the native `popover` attribute. A button
 * opens it with `popoverTarget={id}`; the browser closes it on Escape and on
 * a click outside, and gives focus back to that button. Going to another
 * page closes it too.
 */
export const Popover = ({ className = "", id, side, label, onToggle, children }: PopoverProps) => {
  const panel = useRef<HTMLDivElement>(null);

  const { pathname } = useLocation();

  useEffect(() => {
    if (panel.current?.matches(":popover-open") === true) {
      panel.current.hidePopover();
    }
  }, [pathname]);

  return (
    <div
      className={`header-panel ${className}`}
      ref={panel}
      id={id}
      popover="auto"
      data-side={side}
      role="region"
      aria-label={label}
      onToggle={(event) => onToggle?.(event.newState === "open")}
    >
      {children}
    </div>
  );
};
