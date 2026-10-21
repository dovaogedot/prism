import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Outlet, ScrollRestoration, useLocation } from "react-router";
import { RouteAnnouncer } from "../seo/RouteAnnouncer.tsx";
import { Toaster } from "../ui/index.ts";
import { Drawer, type Drawer as DrawerHandle } from "./drawer.ts";
import { DrawerMenu } from "./DrawerMenu.tsx";
import { Footer } from "./Footer.tsx";
import { Header } from "./Header.tsx";
import { LookClass } from "./look.ts";
import { useWide } from "./use-wide.ts";

/**
 * The header and footer every page sits between, and the drawer a narrow
 * page keeps the header's menus in.
 *
 * Every page under it can put its own part of the drawer in through
 * `useDrawer`. The drawer closes when the page widens past the width it is
 * for and when the shopper goes to another page. A new page opens at the
 * top, and Back returns to where the previous one was scrolled; changing
 * only the query, as the listing's filters do, keeps the scroll.
 */
export const Layout = () => {
  const { pathname } = useLocation();

  const wide = useWide();

  const dialog = useRef<HTMLDialogElement>(null);

  const [slot, setSlot] = useState<HTMLElement | undefined>(undefined);

  // One identity for the whole life of the layout, so React calls it when the
  // slot mounts and unmounts rather than on every render.
  const holdSlot = useCallback((node: HTMLDivElement | null) => {
    setSlot(node === null ? undefined : node);
  }, []);

  const open = useCallback(() => {
    const drawer = dialog.current;
    if (drawer === null) return;

    // Opened again on its way out, it turns back from where it has got to.
    drawer.removeAttribute("data-closing");
    if (!drawer.open) {
      drawer.showModal();
    }
  }, []);

  const close = useCallback(() => {
    const drawer = dialog.current;
    if (drawer === null || !drawer.open || drawer.hasAttribute("data-closing")) return;

    // Slid out while still open, and closed once it is out. Reading the
    // animations settles the style, so the slide the attribute starts is
    // among them; with no slide to wait for, the drawer closes at once.
    drawer.setAttribute("data-closing", "");
    void Promise.allSettled(drawer.getAnimations().map((slide) => slide.finished)).then(() => {
      if (!drawer.hasAttribute("data-closing")) return;

      drawer.removeAttribute("data-closing");
      drawer.close();
    });
  }, []);

  useEffect(close, [wide, pathname, close]);

  const drawer: DrawerHandle = useMemo(() => ({ slot, open }), [slot, open]);

  return (
    <Drawer.Context value={drawer}>
      <div className="flex min-h-dvh flex-col">
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
          href="#main"
        >
          Skip to content
        </a>

        <Header onOpenMenu={open} />

        <dialog
          className="drawer"
          ref={dialog}
          aria-label="Menu"
          // The content fills the dialog, so a click on the dialog itself is a click on the backdrop.
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
          // Escape slides it out too, rather than taking it off the screen.
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between p-4">
              <span className="text-sm font-semibold text-ink">Menu</span>
              <button className={LookClass.icon} type="button" onClick={close} aria-label="Close menu">
                <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
              <DrawerMenu onClose={close} />
              <div ref={holdSlot} />
            </div>
          </div>
        </dialog>

        <main className="flex-1" id="main">
          <Outlet />
        </main>

        <Footer />
        <Toaster />
        <RouteAnnouncer />
        <ScrollRestoration getKey={(location) => location.pathname} />
      </div>
    </Drawer.Context>
  );
};
