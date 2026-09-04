import 'server-only';
import { brevoApiKeyForServer, brevoFromEmailForServer } from '@/lib/runtime/configuration';

export interface TransactionalEmail {
  html: string;
  messageId?: string;
  subject: string;
  to: string;
}

/** `options.signal` is optional and defaults to unbounded (every existing call site keeps its
 * current behavior unchanged) -- callers for whom a hung request must not block their own response
 * (e.g. a best-effort operational alert fired from inside a route handler) can pass
 * `AbortSignal.timeout(ms)` to bound delivery. */
export async function sendTransactionalEmail(message: TransactionalEmail, options: { signal?: AbortSignal } = {}) {
  const apiKey = brevoApiKeyForServer();
  const fromEmail = brevoFromEmailForServer();
  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    body: JSON.stringify({
      headers: message.messageId ? { 'X-Idoc-Message-Id': message.messageId } : undefined,
      htmlContent: message.html,
      sender: { email: fromEmail },
      subject: message.subject,
      to: [{ email: message.to }],
    }),
    headers: { accept: 'application/json', 'api-key': apiKey, 'content-type': 'application/json' },
    method: 'POST', signal: options.signal,
  });
  // Unlike Mandrill (see this file's prior history), Brevo's send API gives a definitive synchronous
  // answer in the HTTP status itself: 2xx means the message was actually accepted for delivery, any
  // other status (401 bad key, 400 malformed request, 402 quota/plan restriction, ...) means it was
  // not, with the reason in the JSON body's `message` field. There is no "200 but silently rejected"
  // case to additionally guard against here.
  if (response.ok) return;
  let reason = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    if (typeof message === 'string' && message) reason = message;
  } catch { /* keep the HTTP-status fallback */ }
  throw new Error(`Brevo did not accept the message (${reason}).`);
}
