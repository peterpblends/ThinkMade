import type { EmailMessage, EmailSender } from './types';

/** Keeps messages in memory. Used by tests and by the local dev "last email" endpoint. */
export function memoryEmailSender(): EmailSender & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    provider: 'memory',
    sent,
    async send(message) {
      sent.push(message);
      return { ok: true, id: `mem-${sent.length}` };
    },
  };
}
