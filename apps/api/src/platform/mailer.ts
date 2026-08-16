/**
 * Outbound email.
 *
 * Delivery is deliberately fire-and-forget from the caller's perspective:
 * `POST /auth/password/forgot` answers 204 whether or not the address exists,
 * and whether or not the SMTP server is reachable. Any other behavior turns
 * the endpoint into an account-enumeration oracle.
 */

import { Option } from "@prism/shared";
import { createTransport, type Transporter } from "nodemailer";

export type Email = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
}>;

export type Mailer = Readonly<{
  send: (email: Email) => Promise<boolean>;
}>;

export type SmtpCredentials = Readonly<{ user: string; password: string }>;

export type MailerOptions = Readonly<{
  host: string;
  port: number;
  /** TLS from the first byte — port 465. STARTTLS on 587 is negotiated. */
  secure: boolean;
  /** Absent for a local relay like Mailpit, which accepts anything. */
  credentials: Option<SmtpCredentials>;
  from: string;
  onFailure: (reason: unknown) => void;
}>;

export const createSmtpMailer = (options: MailerOptions): Mailer => {
  const transport: Transporter = createTransport({
    host: options.host,
    port: options.port,
    secure: options.secure,
    // Mailpit speaks plain SMTP on 1025 with no certificate and no login. A
    // real provider supplies both, and then TLS is not optional.
    ignoreTLS: Option.isNone(options.credentials) && !options.secure,
    ...Option.match<SmtpCredentials, object>({
      onSome: ({ user, password }) => ({ auth: { user, pass: password } }),
      onNone: () => ({}),
    })(options.credentials),
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
};

export type MemoryMailer = Mailer &
  Readonly<{ sent: readonly Email[]; clear: () => void }>;

/** Collects messages in memory so tests can assert on what was sent. */
export const createMemoryMailer = (): MemoryMailer => {
  const sent: Email[] = [];

  return {
    sent,
    send: async (email) => {
      sent.push(email);
      return true;
    },
    // Without this the inbox accumulates across tests, and "the first email
    // sent" stops meaning "the email this test caused".
    clear: () => {
      sent.length = 0;
    },
  };
};
