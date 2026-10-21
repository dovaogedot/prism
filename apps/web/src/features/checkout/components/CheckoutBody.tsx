import {
  Cart,
  CheckoutForm,
  DomainError,
  Price,
  Pricing,
  type CartView,
  type CheckoutPrefill,
  type PlaceOrderResult,
  type SavedAddress,
  type ShippingOption,
} from "@prism/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Stripe, StripeElements } from "@stripe/stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { useWide } from "../../../shared/layout/use-wide.ts";
import { Alert, Button, Card, IssueList } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { CheckoutDefaults, CheckoutIssues, PaymentErrors, PaymentMode } from "../checkout.ts";
import { NextPath } from "../../auth/next-path.ts";
import { AddressFields } from "./AddressFields.tsx";
import { BillingFields } from "./BillingFields.tsx";
import { ContactFields } from "./ContactFields.tsx";
import { OrderSummary } from "./OrderSummary.tsx";
import { PaymentFields } from "./PaymentFields.tsx";
import { SavedAddressPicker } from "./SavedAddressPicker.tsx";
import { ShippingOptions } from "./ShippingOptions.tsx";

/**
 * Whether a card can be taken, and the Stripe objects to take it with. A
 * simulated provider takes no card: placing the order pays for it.
 */
export type CheckoutPayments =
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "simulated" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; stripe: Stripe; elements: StripeElements }>;

/** The cart being bought, the delivery options, how it is paid for, and what a signed-in customer starts with. */
export type CheckoutBodyProps = Readonly<{
  cart: CartView;
  options: readonly [ShippingOption, ...ShippingOption[]];
  payments: CheckoutPayments;
  prefill?: CheckoutPrefill;
  /** The signed-in customer's saved addresses; absent for a guest. */
  savedAddresses?: readonly SavedAddress[];
}>;

/**
 * The single-page checkout: contact, address, shipping, payment and the
 * order summary. "Place order" checks the form, has Stripe check the card,
 * places the order, then confirms the payment with Stripe, stopping at the
 * first step that fails and saying why where it happened.
 */
export const CheckoutBody = ({ cart, options, payments, prefill, savedAddresses }: CheckoutBodyProps) => {
  const navigate = useNavigate();

  const client = useQueryClient();

  const wide = useWide();

  const [problem, setProblem] = useState<ReactNode | undefined>(undefined);

  const [cartProblem, setCartProblem] = useState<string | undefined>(undefined);

  const [paymentError, setPaymentError] = useState<string | undefined>(undefined);

  const form = useForm({
    resolver: zodResolver(CheckoutForm.schema),
    defaultValues:
      prefill === undefined ? CheckoutDefaults.empty(options[0].code) : CheckoutDefaults.fromPrefill(prefill, options),
  });

  const method = useWatch({ control: form.control, name: "shippingMethod" });

  const option = options.find((candidate) => candidate.code === method) ?? options[0];
  const totals = Pricing.totals(cart.lines, option);
  const blocked = Cart.issues(cart.lines).length > 0;
  // Which products the cart holds and how many; a refreshed price or stock leaves it as it is.
  const contents = cart.lines.map((line) => `${line.productId}:${line.quantity}`).join(",");

  // Stripe's fields are told the amount, which has to match the intent the server creates.
  useEffect(() => {
    if (payments.status === "ready") payments.elements.update({ amount: totals.totalCents });
  }, [payments, totals.totalCents]);

  // A refusal about the cart stands until the customer changes what is in it.
  useEffect(() => {
    setCartProblem(undefined);
  }, [contents]);

  const refused = (reason: unknown): void => {
    const failure = Api.failureOf(reason);

    if (failure === undefined) {
      setProblem(Failure.OFFLINE);
      return;
    }

    match(failure.code)
      .with("ValidationFailed", () => {
        const { fields, other } = CheckoutIssues.split(failure.issues);

        for (const field of fields) form.setError(field.path, { message: field.message });
        if (other.length > 0) setProblem(<IssueList issues={other} />);
      })
      .with("OutOfStock", "CartChanged", "CartEmpty", () => {
        setCartProblem(failure.message);
        void client.invalidateQueries({ queryKey: ["cart"] });
      })
      .with("PaymentGatewayUnavailable", "PaymentsUnavailable", () => setPaymentError(failure.message))
      .otherwise(() => setProblem(failure.message));
  };

  const submit = form.handleSubmit(async (values) => {
    setProblem(undefined);
    setCartProblem(undefined);
    setPaymentError(undefined);

    if (payments.status === "simulated") {
      const placed = await Api.post<PlaceOrderResult>("/orders", { ...values, expectedTotalCents: totals.totalCents }).catch(
        (reason: unknown) => {
          refused(reason);
          return undefined;
        },
      );
      if (placed !== undefined) {
        void navigate(`/orders/${placed.orderId}?placed=1${placed.key === undefined ? "" : `&key=${placed.key}`}`);
      }
      return;
    }

    if (payments.status !== "ready") {
      setPaymentError(DomainError.message.PaymentsUnavailable);
      return;
    }

    // Stripe checks the number, expiry and CVC before anything is sent anywhere.
    const checked = await payments.elements.submit();
    if (checked.error !== undefined) {
      setPaymentError(PaymentErrors.messageOf(checked.error));
      return;
    }

    const placed = await Api.post<PlaceOrderResult>("/orders", { ...values, expectedTotalCents: totals.totalCents }).catch(
      (reason: unknown) => {
        refused(reason);
        return undefined;
      },
    );
    if (placed === undefined) return;

    // The cart is not refetched here: the order now holds its stock, so the
    // customer's own lines would read as short. The order page refetches it
    // once the payment settles.
    const target = `/orders/${placed.orderId}?placed=1${placed.key === undefined ? "" : `&key=${placed.key}`}`;
    const confirmed = await payments.stripe
      .confirmPayment({
        elements: payments.elements,
        clientSecret: placed.clientSecret,
        redirect: "if_required",
        confirmParams: { return_url: `${window.location.origin}${target}` },
      })
      .catch(() => ({ error: { type: "api_connection_error" } }));

    if (confirmed.error !== undefined) {
      // The order stays unpaid; Stripe tells the server, which releases the stock and emails.
      setPaymentError(`${PaymentErrors.messageOf(confirmed.error)} Place the order again to retry.`);
      return;
    }

    void navigate(target);
  });

  const summary = (
    <OrderSummary
      cart={cart}
      totals={totals}
      {...(cartProblem === undefined ? {} : { problem: cartProblem })}
    />
  );

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-start">
      {wide ? null : (
        <details className="rounded-lg border border-line bg-surface p-4">
          <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold text-ink">
            <span>Order summary ({cart.itemCount})</span>
            <span className="tabular-nums">{Price.format(totals.totalCents)}</span>
          </summary>
          <div className="pt-2">{summary}</div>
        </details>
      )}

      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-8">
        {problem === undefined ? null : <Alert>{problem}</Alert>}

        {savedAddresses === undefined ? (
          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
            Have an account?{" "}
            <Link className="font-medium text-accent underline underline-offset-2" to={`/login${NextPath.query("/checkout")}`}>
              Sign in for faster checkout
            </Link>
            .
          </p>
        ) : null}

        <ContactFields form={form} />

        <div className="space-y-4">
          {savedAddresses === undefined || savedAddresses.length === 0 ? null : <SavedAddressPicker form={form} addresses={savedAddresses} />}
          <AddressFields form={form} />
          {savedAddresses === undefined ? null : (
            <label className="flex items-center gap-2.5 text-sm text-ink">
              <input className="size-4 accent-[var(--color-accent)]" type="checkbox" {...form.register("shouldSaveAddress")} />
              Save this address to my account
            </label>
          )}
        </div>

        <BillingFields form={form} />
        <ShippingOptions form={form} options={options} subtotalCents={totals.subtotalCents} />
        <PaymentFields
          mode={PaymentMode.of[payments.status]}
          {...(paymentError === undefined ? {} : { error: paymentError })}
        />

        {blocked ? (
          <Alert>Some items are not available in that quantity. Fix them in the summary to place the order.</Alert>
        ) : null}

        <Button
          type="submit"
          busy={form.formState.isSubmitting}
          disabled={blocked || (payments.status !== "ready" && payments.status !== "simulated")}
          className="w-full py-3 text-base"
        >
          Place order
        </Button>
      </form>

      {wide ? <Card className="sticky top-24 p-5">{summary}</Card> : null}
    </div>
  );
};
