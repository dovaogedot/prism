import { Link } from "react-router";
import { useCart } from "../cart.ts";

/** The header's way to the cart, with how many items it holds. */
export const CartButton = () => {
  const cart = useCart();

  const count = cart.data?.itemCount ?? 0;
  const items = count === 1 ? "1 item" : `${count} items`;

  return (
    <Link
      to="/cart"
      aria-label={count === 0 ? "Cart, empty" : `Cart, ${items}`}
      className="relative grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 4h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h8.4a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.2" />
        <circle cx="9.5" cy="19.5" r="1.3" />
        <circle cx="17" cy="19.5" r="1.3" />
      </svg>
      {count === 0 ? null : (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 grid min-w-[1.125rem] place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-[1.125rem] text-accent-ink"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
};
