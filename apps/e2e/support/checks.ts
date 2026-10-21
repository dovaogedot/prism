/**
 * What the suite measures on a page: its head tags, its headings, whether it
 * spills sideways at a width, what axe-core finds, and what the
 * Content-Security-Policy refused.
 */

import { AxeBuilder } from "@axe-core/playwright";
import type { BrowserContext, ConsoleMessage, Page } from "@playwright/test";

declare global {
  // The one place an interface is unavoidable: merging into the DOM's declaration.
  interface Window {
    /** Every Content-Security-Policy violation the page reported. */
    cspViolations?: string[];
  }
}

/** One of the two looks the shop is drawn in. */
export type Theme = "light" | "dark";

/** What a page says about itself in its head and headings. */
export type PageFacts = Readonly<{
  headings: number;
  title: string;
  descriptions: readonly string[];
  robots: string;
  canonical: string;
}>;

export const Checks = {
  /** The widths every page must fit without spilling sideways; 640 is a 1,280-pixel window at 200% zoom. */
  WIDTHS: [320, 640, 768, 1024, 1440],
  THEMES: ["light", "dark"] as const satisfies readonly Theme[],

  /** Stores the theme before any page script runs, as the theme switch does. */
  useTheme: async (context: BrowserContext, theme: Theme): Promise<void> => {
    await context.addInitScript((chosen) => localStorage.setItem("prism-theme", chosen), theme);
  },

  /** Records every Content-Security-Policy violation the context's pages report. */
  watchCsp: async (context: BrowserContext): Promise<void> => {
    await context.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) => window.cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
  },

  cspViolations: (page: Page): Promise<readonly string[]> => page.evaluate(() => window.cspViolations ?? []),

  /** Opens `path` and waits until the page's data has arrived. */
  open: async (page: Page, path: string) => {
    const response = await page.goto(path, { waitUntil: "load" });
    await page.locator("main h1").first().waitFor({ state: "attached" });
    await page.waitForLoadState("networkidle");
    return response;
  },

  facts: (page: Page): Promise<PageFacts> =>
    page.evaluate(() => ({
      headings: document.querySelectorAll("h1").length,
      title: document.title,
      descriptions: [...document.querySelectorAll('meta[name="description"]')].map((meta) => meta.getAttribute("content") ?? ""),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "",
    })),

  /** How many pixels the page is wider than the window at each width, by width; 0 when it fits. */
  overflowAt: async (page: Page, widths: readonly number[]): Promise<Readonly<Record<number, number>>> => {
    const overflow: Record<number, number> = {};

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      // Two frames: the resize lays the page out again before it is measured.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // A page narrower than the window measures below zero, which fits as well as zero does.
      overflow[width] = Math.max(0, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    }

    return overflow;
  },

  /**
   * Google's CAPTCHA frames. axe leaves them out: their markup is Google's,
   * and it differs with the site key a build carries.
   */
  CAPTCHA_FRAMES: 'iframe[src*="google.com/recaptcha"]',

  /** What axe-core finds against WCAG 2.1 Level A, and against the AA color contrast the task asks for, in the shop's own markup. */
  axe: async (page: Page): Promise<readonly string[]> => {
    const levelA = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag21a"]).exclude(Checks.CAPTCHA_FRAMES).analyze();
    const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).exclude(Checks.CAPTCHA_FRAMES).analyze();

    return [...levelA.violations, ...contrast.violations].map(
      (violation) => `${violation.id}: ${violation.nodes.slice(0, 4).map((node) => node.target.join(" ")).join(" | ")}`,
    );
  },

  /**
   * Whether a console error is the shop's own: logged by a document of the
   * shop's origin, not by a third party's frame such as the CAPTCHA's. A
   * refused request is left out; the tests check statuses themselves, and a
   * guest's session refresh is refused by design.
   */
  isOwnError: (message: ConsoleMessage, origin: string): boolean => {
    const source = message.location().url;
    return (source.length === 0 || source.startsWith(origin)) && !message.text().startsWith("Failed to load resource");
  },
} as const;
