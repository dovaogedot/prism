/**
 * What the suite measures on a page: its head tags, its headings, whether it
 * spills sideways at a width, the edges of its controls, what axe-core
 * finds, and what the Content-Security-Policy refused.
 */

import { AxeBuilder } from "@axe-core/playwright"
import type { BrowserContext, ConsoleMessage, Locator, Page } from "@playwright/test"

declare global {
  // The one place an interface is unavoidable: merging into the DOM's declaration.
  interface Window {
    /** Every Content-Security-Policy violation the page reported. */
    cspViolations?: string[]
  }
}

/** One of the two looks the shop is drawn in. */
export type Theme = "light" | "dark"

/** Where an element sits on the page, in CSS pixels. */
export type Box = Readonly<{ x: number; y: number; width: number; height: number }>

/** What a page says about itself in its head and headings. */
export type PageFacts = Readonly<{
  headings: number
  title: string
  descriptions: readonly string[]
  robots: string
  canonical: string
}>

export const Checks = {
  /** The widths every page must fit without spilling sideways; 640 is a 1,280-pixel window at 200% zoom. */
  WIDTHS: [320, 640, 768, 1024, 1440],
  THEMES: ["light", "dark"] as const satisfies readonly Theme[],
  /** How far apart, in CSS pixels, two middles or edges may be and still count as lined up: layout rounds to whole pixels. */
  TOLERANCE: 1,

  /** The box `locator` takes up on the page. */
  boxOf: async (locator: Locator): Promise<Box> => {
    const box = await locator.boundingBox()
    if (box === null) throw new Error(`${locator.toString()} takes up no space on the page`)
    return box
  },

  /**
   * The box the contents of each element of `locator` take up, rather than
   * the element's own box: where a table cell's text sits inside the cell.
   * An element with nothing in it is left out.
   */
  contentBoxesOf: (locator: Locator): Promise<readonly Box[]> =>
    locator.evaluateAll((elements) =>
      elements.flatMap((element) => {
        // Each child by its own box, so a closed <details> counts its summary and not the hidden rest.
        const rects = [...element.childNodes]
          .flatMap((node) => {
            if (node instanceof Element) return [node.getBoundingClientRect()]
            const range = document.createRange()
            range.selectNodeContents(node)
            return [...range.getClientRects()]
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)
        if (rects.length === 0) return []

        const top = Math.min(...rects.map((rect) => rect.top))
        const left = Math.min(...rects.map((rect) => rect.left))
        return [
          {
            x: left,
            y: top,
            width: Math.max(...rects.map((rect) => rect.right)) - left,
            height: Math.max(...rects.map((rect) => rect.bottom)) - top,
          },
        ]
      }),
    ),

  /** How far apart the vertical middles of two boxes are. */
  middleGap: (first: Box, second: Box): number => Math.abs(first.y + first.height / 2 - (second.y + second.height / 2)),

  /** The style of the outline `locator` draws, such as "solid", or "none" when it shows no focus ring. */
  outlineOf: (locator: Locator): Promise<string> => locator.evaluate((element) => getComputedStyle(element).outlineStyle),

  /** Stores the theme before any page script runs, as the theme switch does. */
  useTheme: async (context: BrowserContext, theme: Theme): Promise<void> => {
    await context.addInitScript((chosen) => localStorage.setItem("prism-theme", chosen), theme)
  },

  /** Records every Content-Security-Policy violation the context's pages report. */
  watchCsp: async (context: BrowserContext): Promise<void> => {
    await context.addInitScript(() => {
      window.cspViolations = []
      document.addEventListener("securitypolicyviolation", (event) =>
        window.cspViolations?.push(`${event.violatedDirective} ${event.blockedURI}`),
      )
    })
  },

  cspViolations: (page: Page): Promise<readonly string[]> => page.evaluate(() => window.cspViolations ?? []),

  /**
   * Answers Google's CAPTCHA script with a stand-in that draws a box of the
   * widget's size, so a page check never waits on Google or changes when
   * Google does. The script keeps its address, so the CSP still judges it.
   */
  stubCaptcha: async (context: BrowserContext): Promise<void> => {
    await context.route("https://www.google.com/recaptcha/api.js*", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: `window.grecaptcha = {
          render: (container, options) => {
            const box = document.createElement("div");
            box.style.cssText = options.size === "compact" ? "width:164px;height:144px" : "width:304px;height:78px";
            container.appendChild(box);
            return 0;
          },
          reset: () => {},
        };`,
      }),
    )
  },

  /** Opens `path` and waits until the page's data has arrived. */
  open: async (page: Page, path: string) => {
    const response = await page.goto(path, { waitUntil: "load" })
    await page.locator("main h1").first().waitFor({ state: "attached" })
    await page.waitForLoadState("networkidle")
    return response
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
    const overflow: Record<number, number> = {}

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 })
      // Two frames: the resize lays the page out again before it is measured.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      // A page narrower than the window measures below zero, which fits as well as zero does.
      overflow[width] = Math.max(0, await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    }

    return overflow
  },

  /** The tallest a button, link or group may be and still count as a control rather than a card, in CSS pixels. */
  CONTROL_HEIGHT_MAX: 48,
  /** The least contrast a control's edge has against what is behind it. */
  EDGE_CONTRAST: 2,

  /**
   * Every control on the page whose edge breaks the rule, each as
   * `<control>: <why>`; none when all keep it. A control is a form field, or a
   * button, link or group up to `CONTROL_HEIGHT_MAX` tall: a taller one is a
   * card, drawn with the lighter line. Its edge is `--color-edge`, or the
   * accent of a chosen control or the danger color of a refused field, and
   * has `EDGE_CONTRAST` against the first opaque background behind it.
   */
  findControlEdgeFaults: (page: Page): Promise<readonly string[]> =>
    page.evaluate(
      ({ heightMax, contrastMin }) => {
        // A canvas turns any CSS color, oklch included, into sRGB channels and an alpha.
        const canvas = document.createElement("canvas")
        canvas.width = 1
        canvas.height = 1
        const context = canvas.getContext("2d", { willReadFrequently: true })
        if (context === null) throw new Error("No 2D canvas to read colors with")

        const channelsOf = (color: string): readonly number[] => {
          context.clearRect(0, 0, 1, 1)
          context.fillStyle = color
          context.fillRect(0, 0, 1, 1)
          const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data
          return [red, green, blue, alpha / 255]
        }
        const luminanceOf = (color: readonly number[]): number => {
          const linear = (channel: number) => (channel / 255 <= 0.04045 ? channel / 255 / 12.92 : ((channel / 255 + 0.055) / 1.055) ** 2.4)
          return 0.2126 * linear(color[0] ?? 0) + 0.7152 * linear(color[1] ?? 0) + 0.0722 * linear(color[2] ?? 0)
        }
        const contrastOf = (first: readonly number[], second: readonly number[]): number => {
          const [lighter = 0, darker = 0] = [luminanceOf(first), luminanceOf(second)].toSorted((a, b) => b - a)
          return (lighter + 0.05) / (darker + 0.05)
        }
        const isSame = (first: readonly number[], second: readonly number[]): boolean =>
          first.slice(0, 3).every((channel, index) => Math.abs(channel - (second[index] ?? 0)) <= 2)
        // The backgrounds behind an element, painted over one another up to the first opaque one.
        const backdropOf = (element: Element): readonly number[] => {
          const layers: (readonly number[])[] = []
          for (let node = element.parentElement; node !== null; node = node.parentElement) {
            const color = channelsOf(getComputedStyle(node).backgroundColor)
            if ((color[3] ?? 0) > 0) layers.push(color)
            if ((color[3] ?? 0) >= 0.99) break
          }
          let base: readonly number[] = layers.pop() ?? [255, 255, 255, 1]
          for (let layer = layers.pop(); layer !== undefined; layer = layers.pop()) {
            const alpha = layer[3] ?? 1
            base = base.map((channel, index) => (index === 3 ? 1 : channel * (1 - alpha) + (layer?.[index] ?? 0) * alpha))
          }
          return base
        }

        const root = getComputedStyle(document.documentElement)
        const allowed = ["--color-edge", "--color-accent", "--color-danger"].map((name) => channelsOf(root.getPropertyValue(name)))
        const fields = new Set(["INPUT", "SELECT", "TEXTAREA"])

        return [...document.querySelectorAll("button, a[href], input, select, textarea, summary, [role=group]")].flatMap((element) => {
          const box = element.getBoundingClientRect()
          if (box.width === 0 || box.height === 0 || (!fields.has(element.tagName) && box.height > heightMax)) return []

          const style = getComputedStyle(element)
          const side = (["Top", "Right", "Bottom", "Left"] as const).find(
            (name) => Number.parseFloat(style[`border${name}Width`]) > 0 && (channelsOf(style[`border${name}Color`])[3] ?? 0) > 0,
          )
          if (side === undefined) return []

          const edge = channelsOf(style[`border${side}Color`])
          const contrast = contrastOf(edge, backdropOf(element))
          const name = `${element.tagName.toLowerCase()} "${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}"`
          return [
            ...(allowed.some((color) => isSame(color, edge))
              ? []
              : [`${name}: edge rgb(${edge.slice(0, 3).join(", ")}) is not the shared edge`]),
            ...(contrast >= contrastMin ? [] : [`${name}: edge has ${contrast.toFixed(2)}:1 against its background`]),
          ]
        })
      },
      { heightMax: Checks.CONTROL_HEIGHT_MAX, contrastMin: Checks.EDGE_CONTRAST },
    ),

  /**
   * Google's CAPTCHA frames. axe leaves them out: their markup is Google's,
   * and it differs with the site key a build carries.
   */
  CAPTCHA_FRAMES: 'iframe[src*="google.com/recaptcha"]',

  /** What axe-core finds against WCAG 2.1 Level A, and against the AA color contrast the task asks for, in the shop's own markup. */
  axe: async (page: Page): Promise<readonly string[]> => {
    const levelA = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag21a"]).exclude(Checks.CAPTCHA_FRAMES).analyze()
    const contrast = await new AxeBuilder({ page }).withRules(["color-contrast"]).exclude(Checks.CAPTCHA_FRAMES).analyze()

    return [...levelA.violations, ...contrast.violations].map(
      (violation) =>
        `${violation.id}: ${violation.nodes
          .slice(0, 4)
          .map((node) => node.target.join(" "))
          .join(" | ")}`,
    )
  },

  /**
   * Whether a console error is the shop's own: logged by a document of the
   * shop's origin, not by a third party's frame such as the CAPTCHA's. A
   * refused request is left out: the page tests check the status of every
   * request of the shop's own, and know the ones a page expects refused. So
   * is the report of a
   * third party's page whose own report-only policy asks not to be framed,
   * which Chrome logs in the shop's console though the policy is not the
   * shop's and changes nothing.
   */
  isOwnError: (message: ConsoleMessage, origin: string): boolean => {
    const source = message.location().url
    const text = message.text()
    const framed = /^Framing '([^']+)' violates the following report-only/.exec(text)?.[1]
    const isAnotherSitesPolicy = framed !== undefined && !framed.startsWith(origin)

    return (source.length === 0 || source.startsWith(origin)) && !text.startsWith("Failed to load resource") && !isAnotherSitesPolicy
  },
} as const
