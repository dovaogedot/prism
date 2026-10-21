import type { ImportReport } from "@prism/shared";
import { useState } from "react";
import { match } from "ts-pattern";
import { Api } from "../../../shared/api/client.ts";
import { PageText } from "../../../shared/seo/page-text.ts";
import { Alert, Button, Card, ConfirmDialog, DataTable, Toast } from "../../../shared/ui/index.ts";
import { Failure } from "../../auth/components/failure.tsx";
import { useAdminWrite } from "../admin.ts";
import { AdminPage } from "../components/AdminPage.tsx";

/** Reading where an issue the server found sits in the file. */
const Report = {
  /** `"3:price"` as row 3 and column price; a path without a row is about the whole file. */
  locate: (path: string): Readonly<{ row: number; column: string }> => {
    const [row = "0", ...column] = path.split(":");
    return { row: Number(row), column: column.join(":") };
  },
} as const;

/**
 * Bulk import from a CSV or JSON file. A check reads the whole file and
 * lists every problem by row and column without writing anything; only a
 * file that passed its check can be imported, and then all of it is written
 * at once or none of it.
 */
export const ImportPage = () => {
  const [file, setFile] = useState<File | undefined>(undefined);

  const [report, setReport] = useState<ImportReport | undefined>(undefined);

  const [failure, setFailure] = useState<string | undefined>(undefined);

  const [isConfirming, setConfirming] = useState(false);

  const send = useAdminWrite((change: Readonly<{ file: File; isDryRun: boolean }>) => {
    const form = new FormData();
    form.append("file", change.file);
    return Api.post<ImportReport>(`/admin/products/import?dryRun=${change.isDryRun}`, form);
  });

  const check = (chosen: File): void => {
    setFailure(undefined);
    setReport(undefined);
    send.mutate(
      { file: chosen, isDryRun: true },
      {
        onSuccess: setReport,
        onError: (reason) => {
          const found = Api.failureOf(reason);
          if (found?.code === "ImportInvalid") {
            setReport({ dryRun: true, created: 0, updated: 0, issues: found.issues.map((issue) => ({ ...Report.locate(issue.path), message: issue.message })) });
            return;
          }
          setFailure(Failure.message(reason));
        },
      },
    );
  };

  const isClean = report !== undefined && report.dryRun && report.issues.length === 0;

  return (
    <AdminPage text={PageText.adminImport} heading="Import products">
      <Card className="space-y-4 p-5">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-ink" htmlFor="import-file">
            CSV or JSON file
          </label>
          <input
            className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-lg file:border file:border-line file:bg-sunken file:px-3 file:py-2 file:text-sm file:font-medium file:text-ink"
            id="import-file"
            type="file"
            accept=".csv,.json,text/csv,application/json"
            aria-describedby="import-file-hint"
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setReport(undefined);
            }}
          />
          <p className="text-sm text-ink-faint" id="import-file-hint">
            Up to 2 MB and 5,000 products. A product whose slug exists is updated; any other is created.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="quiet" type="button" disabled={file === undefined} busy={send.isPending && !isConfirming} onClick={() => file !== undefined && check(file)}>
            Check the file
          </Button>
          <Button type="button" disabled={!isClean} onClick={() => setConfirming(true)}>
            Import
          </Button>
        </div>
        {failure === undefined ? null : <Alert>{failure}</Alert>}
      </Card>

      {match(report)
        .with(undefined, () => null)
        .when(
          (found) => found.issues.length === 0,
          (found) => (
            <Alert tone="accent" title={found.dryRun ? "The file is ready to import" : "The file is imported"}>
              {found.dryRun ? "It would create" : "It created"} {found.created} and {found.dryRun ? "update" : "updated"} {found.updated} products.
            </Alert>
          ),
        )
        .otherwise((found) => (
          <div className="space-y-3">
            <Alert title={`The file has ${found.issues.length === 1 ? "1 problem" : `${found.issues.length} problems`}`}>Nothing was written. Fix the file and check it again.</Alert>
            <DataTable
              label="Problems in the file"
              rows={found.issues}
              rowKey={(issue) => `${issue.row}:${issue.column}:${issue.message}`}
              columns={[
                { key: "row", header: "Row", isNumeric: true, cell: (issue) => (issue.row === 0 ? "File" : issue.row) },
                { key: "column", header: "Column", cell: (issue) => issue.column },
                { key: "message", header: "Problem", cell: (issue) => issue.message },
              ]}
            />
          </div>
        ))}

      <Card className="space-y-3 p-5 text-sm text-ink-soft">
        <h2 className="text-base font-semibold text-ink">The file's columns</h2>
        <p>
          A CSV file starts with a row naming its columns: <code className="font-mono text-ink">slug</code>, <code className="font-mono text-ink">name</code>,{" "}
          <code className="font-mono text-ink">description</code>, <code className="font-mono text-ink">price</code> in euros,{" "}
          <code className="font-mono text-ink">stock</code>, <code className="font-mono text-ink">category</code> and <code className="font-mono text-ink">brand</code> by
          their slugs, <code className="font-mono text-ink">weight_g</code>, <code className="font-mono text-ink">width_mm</code>,{" "}
          <code className="font-mono text-ink">height_mm</code>, <code className="font-mono text-ink">depth_mm</code> and <code className="font-mono text-ink">featured</code>{" "}
          (true or false). Each column named <code className="font-mono text-ink">property:Color</code> and so on holds one named property.
        </p>
        <p>
          A JSON file is an array of products with the same fields, the price as <code className="font-mono text-ink">priceCents</code>, the measurements as{" "}
          <code className="font-mono text-ink">weightGrams</code>, <code className="font-mono text-ink">widthMm</code>, <code className="font-mono text-ink">heightMm</code> and{" "}
          <code className="font-mono text-ink">depthMm</code>, and the properties as an object of names and values.
        </p>
      </Card>

      <ConfirmDialog
        isOpen={isConfirming}
        title="Import the file?"
        confirmLabel="Import"
        tone="accent"
        isBusy={send.isPending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          if (file === undefined) return;
          send.mutate(
            { file, isDryRun: false },
            {
              onSuccess: (written) => {
                setConfirming(false);
                setReport(written);
                Toast.show(`Imported: ${written.created} created, ${written.updated} updated.`);
              },
              onError: (reason) => {
                setConfirming(false);
                setFailure(Failure.message(reason));
              },
            },
          );
        }}
      >
        {report === undefined ? "" : `It creates ${report.created} products and updates ${report.updated}, all at once.`} The update replaces each product's fields and properties with the
        file's.
      </ConfirmDialog>
    </AdminPage>
  );
};
