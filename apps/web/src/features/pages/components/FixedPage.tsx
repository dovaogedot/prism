import type { ReactNode } from "react";
import { PageMeta } from "../../../shared/seo/PageMeta.tsx";
import type { PageText } from "../../../shared/seo/page-text.ts";

/** The page's head tags and title, the sentence under its heading, and its text. */
export type FixedPageProps = Readonly<{
  text: PageText;
  /** The h1, when it reads better than the title. */
  heading?: string;
  lede: string;
  children: ReactNode;
}>;

/** A page of running text: the about page, the FAQ, the terms and the privacy policy. */
export const FixedPage = ({ text, heading, lede, children }: FixedPageProps) => (
  <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
    <PageMeta title={text.title} description={text.description} />
    <header className="space-y-3 border-b border-line pb-8">
      <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{heading ?? text.title}</h1>
      <p className="text-lg text-ink-soft">{lede}</p>
    </header>
    <div className="prose-page">{children}</div>
  </article>
);
