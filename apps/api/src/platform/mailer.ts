/**
 * Outbound email. Delivery is fire-and-forget from the caller's view:
 * `POST /auth/password/forgot` answers 204 whether or not the address exists
 * and whether or not the SMTP server is reachable, so the endpoint is not an
 * account-enumeration oracle.
 */

import type { Email } from "@prism/shared";
import { createTransport } from "nodemailer";

/** One message, carrying both bodies so a client can take either. */
export type OutboundEmail = Readonly<{
  to: Email;
  subject: string;
  text: string;
  html: string;
}>;

/** Sending a message. Answers whether it went, and never rejects. */
export type Mailer = Readonly<{
  send: (email: OutboundEmail) => Promise<boolean>;
}>;

/** What an SMTP server asks for before it relays. */
export type SmtpCredentials = Readonly<{ user: string; password: string }>;

/** Which server to hand messages to, and who they come from. */
export type MailerOptions = Readonly<{
  host: string;
  port: number;
  /** TLS from the first byte, as on port 465. STARTTLS on 587 is negotiated. */
  secure: boolean;
  /** Left out for a local relay like Mailpit, which accepts anything. */
  credentials?: SmtpCredentials;
  from: string;
  onFailure: (reason: unknown) => void;
}>;

/** A mailer that keeps what it was given, in the order it was given. */
export type MemoryMailer = Mailer & Readonly<{ sent: readonly OutboundEmail[]; clear: () => void }>;

export const Mailer = {
  /** Hands messages to an SMTP server. A failure is reported and swallowed. */
  smtp: (options: MailerOptions): Mailer => {
    const transport = createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      // Mailpit speaks plain SMTP with no certificate and no login.
      ignoreTLS: options.credentials === undefined && !options.secure,
      ...(options.credentials === undefined
        ? {}
        : { auth: { user: options.credentials.user, pass: options.credentials.password } }),
    });

    return {
      send: (email) =>
        transport
          .sendMail({
            from: options.from,
            to: email.to,
            subject: email.subject,
            text: email.text,
            html: email.html,
          })
          .then(() => true)
          .catch((reason: unknown) => {
            options.onFailure(reason);
            return false;
          }),
    };
  },

  /** Collects messages in memory so tests can assert on what was sent. */
  memory: (): MemoryMailer => {
    const sent: OutboundEmail[] = [];

    return {
      sent,
      send: async (email) => {
        sent.push(email);
        return true;
      },
      clear: () => {
        sent.length = 0;
      },
    };
  },
} as const;
