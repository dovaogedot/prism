import { useLocation } from "react-router";
import { Seo } from "./seo.ts";

/** What a page tells browsers and search engines about itself. */
export type PageMetaProps = Readonly<{
  /** The page's own part of the title, before " | Prism". */
  title: string;
  /** The meta description: 155 to 160 characters. */
  description: string;
  /** The address search engines should file the page under, when not its own path. */
  canonicalPath?: string;
  /** False for a page search engines should leave out: a personal one, or search results. */
  isIndexed?: boolean;
}>;

/**
 * The head tags of the page it is rendered on: the title, the description,
 * and either the canonical address or `noindex`. React puts them in the
 * document's head and takes them out when the page goes.
 */
export const PageMeta = ({ title, description, canonicalPath, isIndexed = true }: PageMetaProps) => {
  const { pathname } = useLocation();

  return (
    <>
      <title>{Seo.title(title)}</title>
      <meta name="description" content={description} />
      {isIndexed ? (
        <link rel="canonical" href={`${window.location.origin}${canonicalPath ?? pathname}`} />
      ) : (
        <meta name="robots" content="noindex" />
      )}
    </>
  );
};
