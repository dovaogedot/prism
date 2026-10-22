import type { ReactNode } from "react";

/** One column: its heading, how a row fills it, and the sort it stands for. */
export type DataTableColumn<Row> = Readonly<{
  key: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** The sort the server knows this column by, when the column sorts. */
  sort?: string;
  /** Numbers line up on the end edge. */
  isNumeric?: boolean;
}>;

/** The sort in force: a column's sort name and its direction. */
export type DataTableSort = Readonly<{ by: string; direction: "ascending" | "descending" }>;

/** The rows, their columns, and the table's accessible name. */
export type DataTableProps<Row> = Readonly<{
  /** Names the table for a screen reader, and the region that scrolls it sideways. */
  label: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  sort?: DataTableSort;
  onSort?: (by: string) => void;
}>;

/**
 * A `<table>` for rows and columns of data. On a narrow screen it scrolls
 * sideways inside a region that takes keyboard focus, so the arrow keys
 * scroll it too. A sortable column's heading is a button, and the column in
 * force carries `aria-sort`. Every cell sits on the middle of its row, level
 * with the row's pictures and buttons.
 */
export const DataTable = <Row,>({ label, columns, rows, rowKey, sort, onSort }: DataTableProps<Row>) => (
  <div className="overflow-x-auto rounded-lg border border-line bg-surface" role="region" aria-label={label} tabIndex={0}>
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">{label}</caption>
      <thead className="border-b border-line bg-sunken text-xs font-semibold uppercase tracking-wider text-ink-soft">
        <tr>
          {columns.map((column) => (
            <th
              className={`whitespace-nowrap px-4 py-2.5 ${column.isNumeric === true ? "text-right" : ""}`}
              key={column.key}
              scope="col"
              aria-sort={column.sort !== undefined && sort?.by === column.sort ? sort.direction : undefined}
            >
              {column.sort === undefined || onSort === undefined ? (
                column.header
              ) : (
                <button className="inline-flex items-center gap-1 uppercase hover:text-ink" type="button" onClick={() => onSort(column.sort ?? "")}>
                  {column.header}
                  <span aria-hidden="true">{sort?.by === column.sort ? ({ ascending: "↑", descending: "↓" } as const)[sort.direction] : "↕"}</span>
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr className="border-b border-line last:border-b-0" key={rowKey(row)}>
            {columns.map((column) => (
              <td className={`px-4 py-3 align-middle ${column.isNumeric === true ? "text-right tabular-nums" : ""}`} key={column.key}>
                {column.cell(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
