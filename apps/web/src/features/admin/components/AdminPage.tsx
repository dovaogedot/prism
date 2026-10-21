import type { ReactNode } from "react";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import type { PageText } from "../../../shared/seo/page-text.ts";

/** The page's head text, its heading when that differs from the title, the buttons beside it, and the page. */
export type AdminPageProps = Readonly<{
  text: PageText;
  heading?: string;
  /** Beside the heading, such as "New product". */
  actions?: ReactNode;
  children: ReactNode;
}>;

/** One admin page: its head tags, which keep it out of search engines, its h1, and its content. */
export const AdminPage = ({ text, heading, actions, children }: AdminPageProps) => (
  <div className="space-y-6">
    <PageMeta title={text.title} description={text.description} isIndexed={false} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{heading ?? text.title.replace(" - Admin", "")}</h1>
      {actions === undefined ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
    {children}
  </div>
);
