import { DomainError } from "@prism/shared";
import { PaymentElement } from "@stripe/react-stripe-js";
import { useState } from "react";
import { Alert } from "../../../shared/ui/index.ts";

/**
 * How this shop takes payment: Stripe's card fields, the simulated provider
 * of a test stack, or not at all; and what went wrong with the payment last time.
 */
export type PaymentFieldsProps = Readonly<{ mode: "card" | "simulated" | "unavailable"; error?: string }>;

/**
 * Stripe's own card fields, in an iframe served by Stripe: the card number,
 * expiry and CVC never pass through this page's code or Prism's server.
 */
export const PaymentFields = ({ mode, error }: PaymentFieldsProps) => {
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-base font-semibold text-ink">5. Payment</legend>

      {mode === "card" ? (
        <PaymentElement
          options={{ layout: "tabs" }}
          onLoadError={(event) => setLoadError(event.error.message ?? "Stripe's card fields did not load.")}
        />
      ) : null}

      {mode === "simulated" ? (
        <Alert title="No card needed" tone="accent">
          Payments are simulated on this server: placing the order pays for it at once, and nothing is charged.
        </Alert>
      ) : null}

      {mode === "unavailable" ? <Alert title="Payments are off">{DomainError.message.PaymentsUnavailable}</Alert> : null}

      {loadError === undefined ? null : <Alert title="The card fields did not load">{loadError}</Alert>}

      {error === undefined ? null : <Alert title="Payment not completed">{error}</Alert>}

      {mode === "card" ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          Card details go straight to Stripe over an encrypted connection. Prism never sees or stores them.
        </p>
      ) : null}
    </fieldset>
  );
};
