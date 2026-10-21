import { Price } from "@prism/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { ImageSet, Popover } from "../../../shared/ui/index.ts";
import { useShippingOptions } from "../../checkout/checkout.ts";
import { CartPreview } from "../cart-preview.ts";
import { FreeShipping, useCart } from "../cart.ts";

/**
 * The header's cart: a button with how many items the cart holds, which
 * opens a preview of the lines, the subtotal and how far the cart is from
 * free shipping, with the way to the cart and to checkout. A change in the
 * count is read out to a screen reader.
 */
export const CartPreviewButton = () => {
  const cart = useCart();

  const shipping = useShippingOptions();

  const [announcement, setAnnouncement] = useState("");

  const count = cart.data?.itemCount ?? 0;
  const items = count === 1 ? "1 item" : `${count} items`;

  // The count last read out; the first one the page loads is not news.
  const announcedCount = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (cart.data === undefined) return;

    if (announcedCount.current !== undefined && announcedCount.current !== count) {
      setAnnouncement(count === 0 ? "Your cart is empty." : `Your cart has ${items}.`);
    }
    announcedCount.current = count;
  }, [cart.data, count, items]);

  return (
    <>
      <button
        className="relative grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
        type="button"
        popoverTarget={CartPreview.PANEL_ID}
        aria-label={count === 0 ? "Cart, empty" : `Cart, ${items}`}
      >
        <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
          <circle cx="9.5" cy="19.5" r="1.3" />
          <circle cx="17" cy="19.5" r="1.3" />
        </svg>
        {count === 0 ? null : (
          <span
            className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 text-[0.625rem] font-bold leading-[1.125rem] text-accent-ink"
            aria-hidden="true"
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <Popover id={CartPreview.PANEL_ID} side="end" label="Cart preview">
        {match(cart.data)
          .with(undefined, () => <p className="p-4 text-sm text-ink-soft">Loading your cart…</p>)
          .when(
            (view) => view.lines.length === 0,
            () => (
              <div className="space-y-3 p-4 text-sm">
                <p className="font-medium text-ink">Your cart is empty.</p>
                <Link className="font-medium text-accent hover:underline" to="/shop">
                  Browse the shop
                </Link>
              </div>
            ),
          )
          .otherwise((view) => {
            const freeShipping = FreeShipping.sentenceOf(shipping.data ?? [], view.subtotalCents);

            return (
              <div className="space-y-3 p-4">
                <p className="text-sm font-semibold text-ink">
                  {items} in your cart
                </p>
                <ul className="max-h-72 space-y-3 overflow-y-auto">
                  {view.lines.map((line) => (
                    <li className="flex items-center gap-3" key={line.productId}>
                      {line.image === undefined ? (
                        <span className="size-12 shrink-0 rounded bg-sunken" aria-hidden="true" />
                      ) : (
                        <ImageSet className="size-12 shrink-0 rounded bg-sunken object-contain" image={line.image} sizes="3rem" isDecorative />
                      )}
                      <div className="min-w-0 flex-1 text-sm">
                        <Link className="line-clamp-2 font-medium text-ink hover:text-accent" to={`/products/${line.slug}`}>
                          {line.name}
                        </Link>
                        <p className="tabular-nums text-ink-soft">
                          {line.quantity} × {Price.format(line.unitPriceCents)}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{Price.format(line.lineTotalCents)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between border-t border-line pt-3 text-sm">
                  <span className="text-ink-soft">Subtotal</span>
                  <span className="font-semibold tabular-nums text-ink">{Price.format(view.subtotalCents)}</span>
                </div>
                {freeShipping === undefined ? null : <p className="text-sm text-ink-soft">{freeShipping}</p>}
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    className="rounded-lg border border-line bg-sunken px-3 py-2 text-center text-sm font-semibold text-ink hover:border-line-strong"
                    to="/cart"
                  >
                    View cart
                  </Link>
                  <Link className="rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-accent-ink hover:bg-accent-hover" to="/checkout">
                    Checkout
                  </Link>
                </div>
              </div>
            );
          })}
      </Popover>
    </>
  );
};
