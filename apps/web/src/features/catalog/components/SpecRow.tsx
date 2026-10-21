/** What the row names, and its value. */
export type SpecRowProps = Readonly<{ label: string; value: string }>;

/** One row of a specification list: a term and its value, inside a `<dl>`. */
export const SpecRow = ({ label, value }: SpecRowProps) => (
  <div className="flex items-baseline justify-between gap-4 py-2">
    <dt className="text-sm capitalize text-ink-soft">{label}</dt>
    <dd className="text-right text-sm font-medium tabular-nums text-ink">{value}</dd>
  </div>
);
