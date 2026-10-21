import type { ProductDetail } from "@prism/shared";
import { useState } from "react";
import { match } from "ts-pattern";
import { SpecRow } from "./SpecRow.tsx";

/** The product whose weight and box are shown. */
export type MeasurementsProps = Readonly<{ product: ProductDetail }>;

/** The weight and the box, read in either unit system. */
export const Measurements = ({ product }: MeasurementsProps) => {
  const [system, setSystem] = useState<"metric" | "imperial">("metric");

  const rows = match(system)
    .with("metric", () => {
      const { width, height, depth } = product.dimensions.millimeters;
      return [
        { label: "Weight", value: `${product.weight.grams} g` },
        { label: "Size", value: `${width} × ${height} × ${depth} mm` },
      ];
    })
    .with("imperial", () => {
      const { width, height, depth } = product.dimensions.inches;
      return [
        { label: "Weight", value: `${product.weight.ounces} oz` },
        { label: "Size", value: `${width} × ${height} × ${depth} in` },
      ];
    })
    .exhaustive();

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Measurements</h2>

        <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Unit system">
          {(["metric", "imperial"] as const).map((option) => (
            <button
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                system === option ? "bg-accent text-accent-ink" : "text-ink-soft hover:text-ink"
              }`}
              key={option}
              type="button"
              onClick={() => setSystem(option)}
              aria-pressed={system === option}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <dl className="divide-y divide-line">
        {rows.map((row) => (
          <SpecRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </div>
  );
};
