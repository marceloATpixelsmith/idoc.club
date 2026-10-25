// Closed vocabulary for the member activity the server records itself (table user_activity_events). Pure, so the
// administrator timeline and the writer share one definition. Every label says what the MEMBER did, or what the
// server decided about what they did; anything else (emails queued, payments, admin changes) is read from the tables
// that already hold it.

export const USER_ACTIVITY_EVENTS = {
  activation_link_opened: 'Opened their activation link',
  activation_submitted: 'Submitted the activation form',
  email_link_clicked: 'Clicked a link in an email',
  password_reset_link_opened: 'Opened their password-reset link',
  password_reset_submitted: 'Submitted the password-reset form',
  sign_in_password_failed: 'Sign-in attempt failed',
} as const;
export type UserActivityEvent = keyof typeof USER_ACTIVITY_EVENTS;

/** The only detail keys a row may carry, each a short categorical value. Nothing free-form, nothing secret. */
export const USER_ACTIVITY_DETAIL_KEYS = ['browser', 'host', 'kind', 'reason', 'signedIn', 'slot'] as const;
export type UserActivityDetail = Partial<Record<(typeof USER_ACTIVITY_DETAIL_KEYS)[number], boolean | string>>;

const MAX_VALUE_LENGTH = 80;

export function sanitizeActivityDetail(detail: Record<string, unknown> | undefined): UserActivityDetail | null {
  if (!detail) return null;
  const clean: UserActivityDetail = {};
  for (const key of USER_ACTIVITY_DETAIL_KEYS) {
    const value = detail[key];
    if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'string' && value) clean[key] = value.slice(0, MAX_VALUE_LENGTH);
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

/** Coarse client class from the User-Agent, never the raw string. `scanner` covers mail-security link checkers and previewers. */
export function classifyUserAgent(userAgent: string | null | undefined): 'browser' | 'missing' | 'scanner' {
  const value = userAgent?.trim();
  if (!value) return 'missing';
  return /bot|crawl|spider|preview|scanner|proofpoint|mimecast|barracuda|safelinks|urldefense|googleimageproxy|curl|python|java\/|go-http|node-fetch|headless/i.test(value) ? 'scanner' : 'browser';
}

/** A stable string for comparing two detail objects: the database stores detail as JSONB, which does not preserve key order, so
 * a plain JSON.stringify of the stored and incoming objects can differ for identical values. */
export function canonicalActivityDetail(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) return 'null';
  return JSON.stringify(Object.entries(detail).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)));
}
