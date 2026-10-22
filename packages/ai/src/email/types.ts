export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type EmailResult = { ok: true; id: string } | { ok: false; error: string };

/** Provider-independent email delivery. Implementations never throw; failures are returned. */
export interface EmailSender {
  readonly provider: string;
  send(message: EmailMessage): Promise<EmailResult>;
}
