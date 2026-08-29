import 'server-only';
import { mailchimpApiKeyForServer } from '@/lib/runtime/configuration';

const FROM_EMAIL = 'accounts@idoc.club';

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
  const apiKey = mailchimpApiKeyForServer();
  const response = await fetch('https://mandrillapp.com/api/1.0/messages/send.json', {
    body: JSON.stringify({ key: apiKey, message: { from_email: FROM_EMAIL, headers: message.messageId ? { 'X-IDOC-Message-ID': message.messageId } : undefined, html: message.html, subject: message.subject, to: [{ email: message.to, type: 'to' }] } }),
    headers: { 'content-type': 'application/json' }, method: 'POST', signal: options.signal,
  });
  if (!response.ok) throw new Error('Mailchimp Transactional rejected the message.');
}
