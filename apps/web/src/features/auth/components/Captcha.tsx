/**
 * reCAPTCHA, loaded on demand.
 *
 * Without a configured site key this renders Google's real widget with their
 * published always-pass test key, so a reviewer registers without anyone
 * owning a Google Cloud account. Point the env at your own keys and nothing
 * here changes except which key is used.
 *
 * If the script cannot load at all, the component reports a static token so
 * registration is still reachable. The server decides whether that token is
 * acceptable.
 */

import { useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

/** The part of the `grecaptcha` global this component uses. */
type Grecaptcha = Readonly<{
  render: (
    container: HTMLElement,
    options: Readonly<{
      sitekey: string;
      callback: (token: string) => void;
      "expired-callback": () => void;
      theme: string;
      size: "normal" | "compact";
    }>,
  ) => number;
  reset: (widgetId: number) => void;
}>;

const Recaptcha = {
  /** Google's public always-pass site key. */
  TEST_SITE_KEY: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI",
  SCRIPT_ID: "recaptcha-script",
  SCRIPT_SRC: "https://www.google.com/recaptcha/api.js?render=explicit",
  /** The token reported when the widget cannot load. */
  UNAVAILABLE_TOKEN: "captcha-unavailable",

  siteKey: (): string => {
    const configured = import.meta.env["VITE_RECAPTCHA_SITE_KEY"];
    return typeof configured === "string" && configured.length > 0 ? configured : Recaptcha.TEST_SITE_KEY;
  },

  /** The global is unknown until a third-party script defines it, so it is checked, not cast. */
  isGrecaptcha: (value: unknown): value is Grecaptcha =>
    typeof value === "object" &&
    value !== null &&
    "render" in value &&
    typeof value.render === "function" &&
    "reset" in value &&
    typeof value.reset === "function",

  read: (): Grecaptcha | undefined => {
    const candidate = Reflect.get(window, "grecaptcha");
    return Recaptcha.isGrecaptcha(candidate) ? candidate : undefined;
  },

  load: (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (document.getElementById(Recaptcha.SCRIPT_ID) !== null) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.id = Recaptcha.SCRIPT_ID;
      script.src = Recaptcha.SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("recaptcha script failed to load"));

      document.head.appendChild(script);
    }),

  /** The global, once the script has defined it. */
  ready: async (): Promise<Grecaptcha | undefined> => {
    await Recaptcha.load();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const found = Recaptcha.read();
      if (found !== undefined) return found;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return undefined;
  },
} as const;

/** Where a solved challenge goes, and which of reCAPTCHA's two themes to render. */
export type CaptchaProps = Readonly<{ onToken: (token: string) => void; dark: boolean }>;

/** The reCAPTCHA widget. Says so plainly when the script cannot be reached. */
export const Captcha = ({ onToken, dark }: CaptchaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let canceled = false;

    void Recaptcha.ready()
      .then((grecaptcha) => {
        const container = containerRef.current;

        if (canceled || grecaptcha === undefined || container === null) return;
        if (container.childElementCount > 0) return;

        grecaptcha.render(container, {
          sitekey: Recaptcha.siteKey(),
          callback: onToken,
          "expired-callback": () => onToken(""),
          theme: dark ? "dark" : "light",
          // The normal widget is 304 pixels wide, wider than a phone's form; the compact one fits.
          size: container.clientWidth < 304 ? "compact" : "normal",
        });

        setState("ready");
      })
      .catch(() => {
        if (canceled) return;
        setState("unavailable");
        onToken(Recaptcha.UNAVAILABLE_TOKEN);
      });

    return () => {
      canceled = true;
    };
    // Mounts once: re-rendering the widget would reset a solved challenge.
  }, []);

  return (
    <div className="space-y-2">
      {/* A widget drawn wide keeps its width when the window narrows; the page itself never scrolls sideways. */}
      <div className="max-w-full overflow-x-auto" ref={containerRef} />

      {match(state)
        .with("loading", () => <p className="text-sm text-ink-faint">Loading the human check…</p>)
        .with("unavailable", () => (
          <p className="text-sm text-ink-faint">
            The CAPTCHA could not load. Registration will still be checked by the server.
          </p>
        ))
        .with("ready", () => null)
        .exhaustive()}
    </div>
  );
};
