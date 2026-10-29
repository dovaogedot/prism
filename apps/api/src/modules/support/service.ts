/**
 * The contact form. A message becomes two emails, and nothing is stored: the
 * message to the support inbox, whose reply goes to the sender, and a fixed
 * confirmation to the address the sender typed. The confirmation carries
 * nothing the sender wrote, since nobody checked that the address is theirs.
 * Everything the sender typed is escaped before it reaches HTML.
 */

import { SupportTopic, type DomainError, type Email, type SupportMessageInput } from "@prism/shared";
import { errAsync, okAsync, ResultAsync } from "neverthrow";
import { Html } from "../../http/html.ts";
import type { CaptchaVerifier } from "../../platform/captcha.ts";
import type { Mailer, OutboundEmail } from "../../platform/mailer.ts";

/** What the contact form works through. */
export type SupportDependencies = Readonly<{ mailer: Mailer; captcha: CaptchaVerifier; inbox: Email }>;

/** Sending one contact message. */
export type SupportService = Readonly<{
  send: (message: SupportMessageInput, ipAddress: string) => ResultAsync<void, DomainError>;
}>;

export const SupportService = {
  /** The message as text lines: who wrote, about what, and what they said. */
  linesOf: (message: SupportMessageInput): readonly string[] => [
    `From: ${message.name} <${message.email}>`,
    `Topic: ${SupportTopic.label[message.topic]}`,
    ...(message.orderNumber === undefined ? [] : [`Order: ${message.orderNumber}`]),
    "",
    message.message,
  ],

  /** The support inbox's email: `intro` above the message, every interpolated value escaped in the HTML body. */
  compose: (to: Email, subject: string, intro: string, message: SupportMessageInput, replyTo?: Email): OutboundEmail => {
    const lines = SupportService.linesOf(message);

    return {
      to,
      ...(replyTo === undefined ? {} : { replyTo }),
      subject,
      text: [intro, "", ...lines].join("\n"),
      html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Prism</p>
      <p style="margin:0 0 16px;line-height:1.6;color:#334155">${Html.escape(intro)}</p>
      <div style="white-space:pre-wrap;line-height:1.6;color:#0f172a;border-left:3px solid #e2e8f0;padding-left:12px">${Html.escape(lines.join("\n"))}</div>
    </div>
  </body>
</html>`,
    };
  },

  /** The sender's confirmation, the same for everyone. */
  confirmationTo: (to: Email): OutboundEmail => {
    const text = "Thank you for writing to Prism. We received your message and answer within two business days.";

    return {
      to,
      subject: "We received your message",
      text,
      html: `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#f8fafc;font-family:ui-sans-serif,system-ui,sans-serif;color:#0f172a">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#64748b">Prism</p>
      <p style="margin:0;line-height:1.6;color:#334155">${text}</p>
    </div>
  </body>
</html>`,
    };
  },

  create: (deps: SupportDependencies): SupportService => ({
    // The message counts as sent once the support inbox has it; a lost confirmation loses nothing.
    send: (message, ipAddress) =>
      deps.captcha
        .verify(message.captchaToken, ipAddress)
        .andThen(() =>
          ResultAsync.fromSafePromise(
            deps.mailer.send(
              SupportService.compose(
                deps.inbox,
                `[${SupportTopic.label[message.topic]}] Message from ${message.name}`,
                "A customer wrote through the contact form. Replying answers them.",
                message,
                message.email,
              ),
            ),
          ),
        )
        .andThen((isDelivered) => (isDelivered ? okAsync<void, DomainError>(undefined) : errAsync<void, DomainError>({ _tag: "MessageNotSent" })))
        .andThen(() => ResultAsync.fromSafePromise(deps.mailer.send(SupportService.confirmationTo(message.email)).then(() => undefined))),
  }),
} as const;
