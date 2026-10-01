import { PaymentFailure, type OrderDetail } from "@prism/shared";
import { Link } from "react-router";
import { match } from "ts-pattern";
import { Alert, Spinner } from "../../../shared/ui/index.ts";

/** The order just placed, and whether the page is still watching for its payment. */
export type OrderConfirmationProps = Readonly<{ order: OrderDetail; watching: boolean }>;

/** What the customer sees first right after paying, as the payment settles. */
export const OrderConfirmation = ({ order, watching }: OrderConfirmationProps) =>
  match(order.status)
    .with("pending_payment", () =>
      watching ? (
        <Alert tone="accent" title="Thank you for your order">
          <span className="inline-flex items-center gap-2">
            <Spinner /> Waiting for the payment to be confirmed…
          </span>
        </Alert>
      ) : (
        <Alert tone="accent" title="Thank you for your order">
          The payment is still being confirmed. We will email {order.contact.email} as soon as it is.
        </Alert>
      ),
    )
    .with("payment_failed", () => (
      <Alert title="The payment did not go through">
        {order.payment?.failure === undefined ? "The payment could not be completed." : PaymentFailure.message[order.payment.failure]}{" "}
        You have not been charged, and your cart still holds the items.{" "}
        <Link to="/checkout" className="font-medium text-accent hover:underline">
          Try again
        </Link>
      </Alert>
    ))
    .with("canceled", () => null)
    .otherwise(() => (
      <Alert tone="accent" title="Thank you, your order is confirmed">
        We sent the confirmation to {order.contact.email}.
      </Alert>
    ));

