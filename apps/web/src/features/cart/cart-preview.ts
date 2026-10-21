/** The header's cart preview, which adding to the cart opens. */

export const CartPreview = {
  /** The preview panel's id; the header renders one, on every page. */
  PANEL_ID: "cart-preview",

  /** Opens the preview, unless it is open already. */
  open: (): void => {
    const panel = document.getElementById(CartPreview.PANEL_ID);
    if (panel === null || panel.matches(":popover-open")) return;

    panel.showPopover();
  },
} as const;
