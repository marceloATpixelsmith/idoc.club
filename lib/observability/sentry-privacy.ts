const SENSITIVE_KEY = /(?:authorization|cookie|password|passwd|secret|token|mfa|totp|recovery|card|payment|stripe|body|form|payload)/i;
const URL_VALUE = /([?&][^=&#]+)=([^&#]*)/g;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const IPV4_VALUE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const RECOVERY_CODE_VALUE = /\b(recovery(?:\s+code)?\s*[:=]?\s*)[A-Z0-9-]{6,}\b/gi;
const MFA_CODE_VALUE = /\b((?:mfa|totp|otp)(?:\s+code)?\s*[:=]?\s*)\d{4,10}\b/gi;

type SentryLikeEvent = {
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  request?: {
    cookies?: unknown;
    data?: unknown;
    headers?: Record<string, unknown>;
    query_string?: unknown;
    url?: string;
    [key: string]: unknown;
  };
  tags?: Record<string, string | number | boolean>;
  user?: Record<string, unknown>;
  [key: string]: unknown;
};

function redactString(value: string): string {
  return value
    .replace(BEARER_VALUE, 'Bearer [Filtered]')
    .replace(URL_VALUE, '$1=[Filtered]')
    .replace(EMAIL_VALUE, '[Filtered email]')
    .replace(IPV4_VALUE, '[Filtered IP]')
    .replace(RECOVERY_CODE_VALUE, '$1[Filtered]')
    .replace(MFA_CODE_VALUE, '$1[Filtered]');
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[Filtered]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[Filtered]' : sanitizeValue(nested, depth + 1),
    ]),
  );
}

/** Defense-in-depth for every Sentry runtime. SDK PII collection remains disabled as the primary
 * control; this removes request content and common secret-bearing fields if an integration or an
 * explicit capture adds them later. */
export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = sanitizeValue(event) as T & SentryLikeEvent;
  if (sanitized.request) {
    delete sanitized.request.cookies;
    delete sanitized.request.data;
    delete sanitized.request.query_string;
    if (sanitized.request.url) sanitized.request.url = sanitized.request.url.split('?')[0];

    const requestId = Object.entries(sanitized.request.headers ?? {}).find(
      ([key]) => key.toLowerCase() === 'x-request-id',
    )?.[1];
    sanitized.request.headers = {};
    if (typeof requestId === 'string') {
      sanitized.request.headers['x-request-id'] = requestId;
      sanitized.tags = { ...sanitized.tags, idoc_request_id: requestId };
      sanitized.contexts = {
        ...sanitized.contexts,
        idoc: { request_id: requestId },
      };
    }
  }

  // IDOC never associates email, IP address, or browser/session identifiers with an error. An
  // explicitly supplied internal numeric id is the only user field allowed through.
  const internalId = sanitized.user?.id;
  sanitized.user = typeof internalId === 'string' && /^\d+$/.test(internalId) ? { id: internalId } : undefined;
  return sanitized;
}

/** Breadcrumbs (console output, fetch/XHR URLs, UI clicks) are recorded as they happen, before any event exists for beforeSend to clean,
 * and they can carry query-string tokens, emails or form text. Cleaned here as each one is recorded, so what is held in memory and
 * attached to a later error is already free of them. */
export function sanitizeSentryBreadcrumb<T>(breadcrumb: T): T {
  const sanitized = sanitizeValue(breadcrumb) as T & { data?: { url?: unknown; to?: unknown; from?: unknown }; message?: unknown };
  for (const key of ['url', 'to', 'from'] as const) {
    const value = sanitized.data?.[key];
    if (sanitized.data && typeof value === 'string') sanitized.data[key] = value.split(/[?#]/)[0];
  }
  return sanitized;
}

// Errors a visitor (or a scanner) causes with a malformed or unauthorised request, which the application already answers correctly (a
// 4xx or a refusal). Left in Sentry they bury the errors that matter: the 2026-10-27 list was mostly these. The server logs still
// carry every such request; only the Sentry alert is skipped. Malformed requests the application itself mishandled (an action posted
// without its form payload) are fixed at the source rather than hidden here.
const EXPECTED_REQUEST_ERROR_MESSAGES = [
  /^Invalid Server Actions request/i,
  /^Failed to find Server Action/i,
  /^Multipart: Boundary not found/i,
  /^The router state header was sent but could not be parsed/i,
  /^Connection closed\.?$/i,
];
const EXPECTED_DENIAL_TYPES = new Set(['AuthorizationError', 'CsrfError']);

export function isExpectedClientCausedEvent(event: unknown): boolean {
  const values = (event as { exception?: { values?: { type?: string; value?: string; mechanism?: { type?: string } }[] } })?.exception?.values;
  if (!values?.length) return false;
  return values.every((entry) => entry.mechanism?.type === 'auto.function.nextjs.on_request_error'
    && (EXPECTED_DENIAL_TYPES.has(entry.type ?? '') || EXPECTED_REQUEST_ERROR_MESSAGES.some((pattern) => pattern.test(entry.value ?? ''))));
}

/** The beforeSend hook for every runtime: drops expected client-caused events, otherwise removes request content and secrets. */
export function prepareSentryEvent<T>(event: T): T | null {
  return isExpectedClientCausedEvent(event) ? null : sanitizeSentryEvent(event);
}
