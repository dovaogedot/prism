import { Quantity, type ProductDetail } from "@prism/shared";
import { useState } from "react";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { Alert, Button } from "../../../shared/ui/index.ts";
import { CartFailure, useCartChanges } from "../cart.ts";
import { QuantityStepper } from "./QuantityStepper.tsx";

/** The product the buttons add. */
export type AddToCartProps = Readonly<{ product: ProductDetail }>;

/** A quantity and an add button, or a sold-out notice when there is nothing to add. */
export const AddToCart = ({ product }: AddToCartProps) => {
  const [quantity, setQuantity] = useState(1);

  const { add } = useCartChanges();

  if (product.stock <= 0) {
    return (
      <Button type="button" tone="quiet" disabled className="w-full sm:w-auto">
        Sold out
      </Button>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <QuantityStepper
          value={quantity}
          max={Math.min(product.stock, Quantity.MAX)}
          onChange={setQuantity}
          label={product.name}
          disabled={add.isPending}
        />
        <Button
          type="button"
          busy={add.isPending}
          onClick={() => add.mutate({ productId: product.id, quantity })}
          className="flex-1 sm:flex-none"
        >
          Add to cart
        </Button>
      </div>

      {match(add.status)
        .with("error", () => <Alert>{CartFailure.message(add.error)}</Alert>)
        .with("success", () => (
          <p role="status" className="text-sm text-ink-soft">
            Added to your cart.{" "}
            <Link to="/cart" className="font-medium text-accent hover:underline">
              View cart
            </Link>
          </p>
        ))
        .otherwise(() => null)}
    </div>
  );
};
