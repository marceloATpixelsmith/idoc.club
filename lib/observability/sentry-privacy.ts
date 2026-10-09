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
