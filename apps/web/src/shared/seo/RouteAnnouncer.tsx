import { useEffect, useRef, useState } from "react"
import { useLocation } from "react-router"
import { PageHeading } from "./page-heading.ts"

/**
 * Keeping focus on a newly opened page's heading while the page loads. A
 * page shows a heading while its data loads and another once it has it, so
 * the heading that took focus can leave the page a moment later, however
 * long the data takes.
 */
const Settling = {
  /** How long the title has to stay the same before it is read out, so a loading title is skipped. */
  QUIET_MS: 400,

  /**
   * Moves focus to the page's h1, and calls `announce` with the page's title
   * once the title has stayed the same for a moment. Until the returned
   * function stops it, a heading that replaces the focused one takes focus in
   * turn, unless the reader has moved it elsewhere. A form field the page
   * focused itself, such as a code field, keeps focus.
   */
  watch: (announce: (title: string) => void): (() => void) => {
    const state: { focused: HTMLElement | undefined; quiet: number | undefined } = { focused: undefined, quiet: undefined }

    const refocus = (): void => {
      const heading = PageHeading.find()
      if (heading === null || heading === state.focused) return

      const active = document.activeElement
      if (state.focused === undefined && active instanceof HTMLElement && active.matches("main input, main select, main textarea")) {
        state.focused = active
        return
      }

      // A heading counts as focused only once focus has landed on it, so one
      // behind the closing drawer is tried again.
      const isFocusLost = state.focused === undefined || (!state.focused.isConnected && document.activeElement === document.body)
      if (isFocusLost && PageHeading.focus(heading)) {
        state.focused = heading
      }
    }

    // Only the title restarts the wait; the rest of the page may keep changing for a while.
    const scheduleAnnouncement = (): void => {
      window.clearTimeout(state.quiet)
      state.quiet = window.setTimeout(() => announce(document.title), Settling.QUIET_MS)
    }

    const page = new MutationObserver(refocus)
    const head = new MutationObserver(scheduleAnnouncement)
    page.observe(document.body, { childList: true, subtree: true })
    head.observe(document.head, { childList: true, subtree: true, characterData: true })

    refocus()
    scheduleAnnouncement()

    return () => {
      page.disconnect()
      head.disconnect()
      window.clearTimeout(state.quiet)
    }
  },
} as const

/**
 * Tells a screen reader that the page changed, which a page swapped in
 * without a load does not do by itself: focus moves to the new page's h1,
 * and its title is read out from a polite live region. The first page is
 * left alone, because the browser announces a page it loads.
 */
export const RouteAnnouncer = () => {
  const { pathname } = useLocation()

  const [announcement, setAnnouncement] = useState("")

  // The path last announced, so the first render and its development-mode repeat announce nothing.
  const announced = useRef(pathname)

  useEffect(() => {
    if (announced.current === pathname) return
    announced.current = pathname

    return Settling.watch(setAnnouncement)
  }, [pathname])

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {announcement}
    </p>
  )
}
