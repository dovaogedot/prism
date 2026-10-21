import type { ReactNode } from "react";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import type { PageText } from "../../../shared/seo/page-text.ts";
import { AccountNav } from "./AccountNav.tsx";

/** The page's head text, its heading, and the page. */
export type AccountPageProps = Readonly<{ text: PageText; heading: string; children: ReactNode }>;

/**
 * One of the signed-in customer's own pages: its head tags, which keep it out
 * of search engines, its h1, the tabs between the account's pages, and its
 * content. Every account page has the same width.
 */
export const AccountPage = ({ text, heading, children }: AccountPageProps) => (
  <div className="mx-auto max-w-4xl space-y-6 px-4 py-10 sm:px-6">
    <PageMeta title={text.title} description={text.description} isIndexed={false} />
    <header className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{heading}</h1>
      <AccountNav />
    </header>
    {children}
  </div>
);
