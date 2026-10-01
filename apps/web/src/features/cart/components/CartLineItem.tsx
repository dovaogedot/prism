import { Cart, Price, Quantity, type CartLine } from "@prism/shared";
import { Link } from "react-router";
import { match, P } from "ts-pattern";
import { Picture } from "../../catalog/components/ProductCard.tsx";
import { CartFailure, useCartChanges } from "../cart.ts";
import { QuantityStepper } from "./QuantityStepper.tsx";

/** One line, and whether it is drawn in the narrow checkout summary. */
export type CartLineItemProps = Readonly<{ line: CartLine; compact?: boolean }>;

/**
 * A cart line: its picture, name, unit price, quantity, total and a remove
 * button. A line the shop cannot supply in full says so, with a way to fix it.
 */
export const CartLineItem = ({ line, compact = false }: CartLineItemProps) => {
  const { setQuantity, remove } = useCartChanges();

  const short = line.quantity > line.stock;
  const failure = setQuantity.error ?? remove.error;

  return (
    <li className="flex gap-3 py-4 sm:gap-4">
      <Link to={`/item/${line.slug}`} className="shrink-0">
        <Picture
          image={line.image}
          name={line.name}
          className={`${compact ? "size-14" : "size-20 sm:size-24"} rounded-lg border border-line`}
        />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/item/${line.slug}`} className="line-clamp-2 text-sm font-semibold text-ink hover:text-accent">
              {line.name}
            </Link>
            <p className="text-sm tabular-nums text-ink-soft">{Price.format(line.unitPriceCents)} each</p>
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-ink">{Price.format(line.lineTotalCents)}</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <QuantityStepper
            value={line.quantity}
            max={Math.max(line.quantity, Math.min(line.stock, Quantity.MAX))}
            onChange={(quantity) => setQuantity.mutate({ productId: line.productId, quantity })}
            label={line.name}
            disabled={remove.isPending}
          />
          <button
            type="button"
            onClick={() => remove.mutate(line.productId)}
            disabled={remove.isPending}
            className="text-sm font-medium text-ink-soft hover:text-danger"
          >
            Remove
          </button>
        </div>

        {match({ short, stock: line.stock })
          .with({ short: true, stock: P.number.lte(0) }, () => (
            <p role="alert" className="text-sm font-medium text-danger">
              {Cart.shortage(0)} Remove it to check out.
            </p>
          ))
          .with({ short: true }, ({ stock }) => (
            <p role="alert" className="flex flex-wrap items-center gap-2 text-sm font-medium text-warn">
              {Cart.shortage(stock)}
              <button
                type="button"
                onClick={() => setQuantity.mutate({ productId: line.productId, quantity: stock })}
                className="rounded-md border border-current px-2 py-0.5 text-xs"
              >
                Reduce to {stock}
              </button>
            </p>
          ))
          .otherwise(() => null)}

        {failure === null ? null : (
          <p role="alert" className="text-sm text-danger">
            {CartFailure.message(failure)}
          </p>
        )}
      </div>
    </li>
  );
};
