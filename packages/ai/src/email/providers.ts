import { consoleEmailSender } from './console';
import type { EmailSender } from './types';

async function failText(res: Response) {
  return `${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`;
}

/** Resend (free tier: 3,000/month, 100/day). Requires a verified sending domain. */
export function createResendSender(cfg: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = cfg.fetch ?? fetch;
  return {
    provider: 'resend',
    async send(m) {
      try {
        const res = await doFetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from: cfg.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, error: `Resend ${await failText(res)}` };
        return { ok: true, id: ((await res.json()) as { id: string }).id };
      } catch (err) {
        return { ok: false, error: `Resend unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

/** Brevo (free tier: 300/day). Can send from a verified single sender address. */
export function createBrevoSender(cfg: { apiKey: string; from: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = cfg.fetch ?? fetch;
  return {
    provider: 'brevo',
    async send(m) {
      try {
        const res = await doFetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { email: cfg.from, name: 'ThinkMade' }, to: [{ email: m.to }], subject: m.subject, textContent: m.text, ...(m.html ? { htmlContent: m.html } : {}) }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return { ok: false, error: `Brevo ${await failText(res)}` };
        return { ok: true, id: ((await res.json()) as { messageId: string }).messageId };
      } catch (err) {
        return { ok: false, error: `Brevo unreachable: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  };
}

/** Resend if configured, then Brevo; the console in development; otherwise a sender that always reports failure. */
export function createEmailSender(env: Record<string, string | undefined> = process.env): EmailSender {
  const from = env.EMAIL_FROM ?? 'ThinkMade <no-reply@thinkmade.zicaworld.com>';
  if (env.RESEND_API_KEY) return createResendSender({ apiKey: env.RESEND_API_KEY, from });
  if (env.BREVO_API_KEY) return createBrevoSender({ apiKey: env.BREVO_API_KEY, from: from.replace(/^.*<(.+)>$/, '$1') });
  if (env.NODE_ENV !== 'production') return consoleEmailSender();
  return {
    provider: 'none',
    async send() {
      return { ok: false, error: 'Email is not configured (set RESEND_API_KEY or BREVO_API_KEY, and EMAIL_FROM).' };
    },
  };
}
