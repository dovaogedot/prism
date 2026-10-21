import { match, P } from "ts-pattern";

/** How many are in stock, and the classes of the line. */
export type StockProps = Readonly<{ className: string; count: number }>;

/** How many are left, in the three steps the shop distinguishes. */
export const Stock = ({ className, count }: StockProps) =>
  match(count)
    .with(0, () => <span className={`${className} font-medium text-danger`}>Out of stock</span>)
    .with(P.number.lte(5), (remaining) => <span className={`${className} font-medium text-warn`}>Only {remaining} left</span>)
    .otherwise(() => <span className={`${className} text-ink-faint`}>In stock</span>);
