import type { EmailSender } from './types';

/** Prints messages to the server log. Local development only: nothing is delivered. */
export function consoleEmailSender(): EmailSender {
  let n = 0;
  return {
    provider: 'console',
    async send(message) {
      n += 1;
      console.info(`\n[email:console] To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
      return { ok: true, id: `console-${n}` };
    },
  };
}
