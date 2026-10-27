import 'server-only';
import { assertTransactionalEmailAllowed } from '@/lib/runtime/member-launch-hold';
import { brevoApiKeyForServer, brevoFromEmailForServer } from '@/lib/runtime/configuration';
import { tracedFetch } from '@/lib/observability/outbound-fetch';
import { assertEmailLinksCanonical } from './email-link-policy.ts';
import { normalizeBrevoMessageId } from './email-delivery-log-core.ts';

const DELIVERY_LOG_TIMEOUT_MS = 3_000;

/** Best effort: the email is already accepted, so recording it (with Brevo's message id, which the webhook later uses to report
 * what became of it) must never fail the send, and a slow or unreachable database must not hold the caller up. */
async function logAcceptedSend(response: Response, message: TransactionalEmail, options: { kind?: string; userId?: number | null }) {
  try {
    let providerMessageId: string | null = null;
    try { providerMessageId = normalizeBrevoMessageId(((await response.json()) as { messageId?: unknown }).messageId); } catch { /* a send without a readable id is still logged */ }
    const { recordAcceptedEmail } = await import('./email-delivery-log');
    await Promise.race([
      recordAcceptedEmail({ kind: options.kind, messageRef: message.messageId, providerMessageId, subject: message.subject, to: message.to, userId: options.userId }),
      new Promise<void>((resolve) => setTimeout(resolve, DELIVERY_LOG_TIMEOUT_MS).unref()),
    ]);
  } catch { /* best effort */ }
}

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
export async function sendTransactionalEmail(message: TransactionalEmail, options: { allowLiveAuthE2eOtp?: boolean; authenticationEmail?: boolean; kind?: string; signal?: AbortSignal; userId?: number | null } = {}) {
  assertTransactionalEmailAllowed('email.transactional', message.to, options.allowLiveAuthE2eOtp, options.authenticationEmail);
  // Every message, whichever builder made it, must link only to idoc.club when sent from Production.
  assertEmailLinksCanonical(message.html);
  const apiKey = brevoApiKeyForServer();
  const fromEmail = brevoFromEmailForServer();
  const response = await tracedFetch('brevo', 'https://api.brevo.com/v3/smtp/email', {
    body: JSON.stringify({
      headers: message.messageId ? { 'X-Idoc-Message-Id': message.messageId } : undefined,
      htmlContent: message.html,
      sender: { email: fromEmail, name: 'Accounts' },
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
  if (response.ok) {
    await logAcceptedSend(response, message, options);
    return;
  }
  let reason = `HTTP ${response.status}`;
  try {
    const body: unknown = await response.json();
    const message = body && typeof body === 'object' ? (body as { message?: unknown }).message : undefined;
    if (typeof message === 'string' && message) reason = message;
  } catch { /* keep the HTTP-status fallback */ }
  throw new Error(`Brevo did not accept the message (${reason}).`);
}
