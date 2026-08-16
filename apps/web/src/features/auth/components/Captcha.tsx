/**
 * reCAPTCHA, loaded on demand.
 *
 * In `test` mode this renders Google's real widget using their published
 * always-pass test site key — the challenge is genuine, it simply always
 * succeeds, which is what lets a reviewer register without anyone owning a
 * Google Cloud account. Point the env at your own keys and nothing here
 * changes except which key is used.
 *
 * If the script cannot load at all — offline, blocked — the component reports
 * a static token so registration is still reachable. The server is the one
 * that decides whether that token is acceptable, and in `google` mode it
 * will not be.
 */

import { Option } from "@prism/shared";
import { useEffect, useRef, useState } from "react";
import { match } from "ts-pattern";

const TEST_SITE_KEY = "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI";
const SCRIPT_ID = "recaptcha-script";
const SCRIPT_SRC = "https://www.google.com/recaptcha/api.js?render=explicit";

const siteKey = (): string => {
  const configured = import.meta.env["VITE_RECAPTCHA_SITE_KEY"];
  return typeof configured === "string" && configured.length > 0
    ? configured
    : TEST_SITE_KEY;
};

type Grecaptcha = Readonly<{
  render: (
    container: HTMLElement,
    options: Readonly<{ sitekey: string; callback: (token: string) => void; "expired-callback": () => void; theme: string }>,
  ) => number;
  reset: (widgetId: number) => void;
}>;

/**
 * A type predicate rather than a cast: the global is genuinely unknown until
 * a third-party script defines it, and this is where that gets checked.
 */
const isGrecaptcha = (value: unknown): value is Grecaptcha =>
  typeof value === "object" &&
  value !== null &&
  "render" in value &&
  typeof value.render === "function" &&
  "reset" in value &&
  typeof value.reset === "function";

const readGrecaptcha = (): Option<Grecaptcha> => {
  const candidate = Reflect.get(window, "grecaptcha");
  return isGrecaptcha(candidate) ? Option.some(candidate) : Option.none;
};

const loadScript = (): Promise<void> =>
  new Promise((resolve, reject) => {
    if (document.getElementById(SCRIPT_ID) !== null) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("recaptcha script failed to load"));

    document.head.appendChild(script);
  });

export type CaptchaProps = Readonly<{
  onToken: (token: string) => void;
  dark: boolean;
}>;

export const Captcha = ({ onToken, dark }: CaptchaProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let canceled = false;

    const start = async (): Promise<void> => {
      await loadScript();

      // The script defines grecaptcha shortly after load resolves.
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (canceled) return;
        if (Option.isSome(readGrecaptcha())) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const grecaptcha = readGrecaptcha();
      const container = containerRef.current;

      if (canceled || Option.isNone(grecaptcha) || container === null) return;
      if (container.childElementCount > 0) return;

      grecaptcha.value.render(container, {
        sitekey: siteKey(),
        callback: onToken,
        "expired-callback": () => onToken(""),
        theme: dark ? "dark" : "light",
      });

      setState("ready");
    };

    void start().catch(() => {
      if (canceled) return;
      setState("unavailable");
      // Let the server reject it if it wants to; do not block the form here.
      onToken("captcha-unavailable");
    });

    return () => {
      canceled = true;
    };
    // Deliberately mounts once: re-rendering the widget would reset a
    // challenge the visitor may already have solved.
  }, []);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />

      {match(state)
        .with("loading", () => (
          <p className="text-sm text-ink-faint">Loading the human check…</p>
        ))
        .with("unavailable", () => (
          <p className="text-sm text-ink-faint">
            The CAPTCHA could not load. Registration will still be checked by the
            server.
          </p>
        ))
        .with("ready", () => null)
        .exhaustive()}
    </div>
  );
};
