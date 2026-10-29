import { useState } from "react"
import { Link } from "react-router"
import { Dialog } from "../../../shared/ui/index.ts"
import { StepUpForm } from "./StepUpForm.tsx"

/** What happens once the code is accepted. */
export type StepUpDialogProps = Readonly<{ onDone: () => void }>

/**
 * Asks for a fresh code over the admin page that is open, so the page and
 * whatever was typed into it stay as they are. Closing it opens it again;
 * the way out is back to the shop.
 */
export const StepUpDialog = ({ onDone }: StepUpDialogProps) => {
  const [openings, setOpenings] = useState(0)

  return (
    <Dialog key={openings} isOpen title="Confirm it is you" onClose={() => setOpenings((count) => count + 1)}>
      <p className="text-sm text-ink-soft">
        The admin asks for a current code from your authenticator app every few hours. What you typed on this page stays as it is.
      </p>
      <StepUpForm onDone={onDone} />
      <p className="text-sm">
        <Link className="font-medium text-accent underline underline-offset-2" to="/">
          Back to the shop
        </Link>
      </p>
    </Dialog>
  )
}
