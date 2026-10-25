// Pure rules for the administrator Member timeline (docs/07, docs/29). Every row says WHO did it: the member (`user`),
// the server on its own (`server`), or an administrator (`administrator`), and where the fact was read from (`idoc` = our
// own records, `brevo` = Brevo's delivery log). No IO here so the labelling can be unit tested.

export type TimelineActor = 'administrator' | 'server' | 'user';
export type TimelineSource = 'brevo' | 'idoc';
export type TimelineEntry = {
  actor: TimelineActor;
  at: string;
  category: string;
  detail?: string;
  id: string;
  source: TimelineSource;
  title: string;
};

export const TIMELINE_ACTOR_LABELS: Record<TimelineActor, string> = { administrator: 'Administrator', server: 'Server', user: 'Member' };

const DAY_MS = 86_400_000;
export const DEFAULT_RANGE_DAYS = 30;
export const MAX_RANGE_DAYS = 366;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive UTC day range: `from` 00:00:00 to the end of `to`. Defaults to the last 30 days; anything invalid, reversed or
 * longer than a year falls back to the default so a hand-edited request can never ask for an unbounded scan. */
export function timelineRange(from: string | null | undefined, to: string | null | undefined, now: Date = new Date()): { from: Date; fromKey: string; to: Date; toKey: string } {
  const todayKey = now.toISOString().slice(0, 10);
  const valid = (value: string | null | undefined): value is string => Boolean(value && DATE_KEY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
  let toKey = valid(to) ? to : todayKey;
  let fromKey = valid(from) ? from : new Date(Date.parse(`${toKey}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const span = (Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / DAY_MS;
  if (span < 0 || span > MAX_RANGE_DAYS) {
    toKey = todayKey;
    fromKey = new Date(Date.parse(`${toKey}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  }
  return { from: new Date(`${fromKey}T00:00:00Z`), fromKey, to: new Date(Date.parse(`${toKey}T00:00:00Z`) + DAY_MS - 1), toKey };
}

/** Who performed an audit-log action on this member's account. A `member.*` action is the member acting through the site (the row
 * has no actor id because the request was theirs), an `admin.*` action is an administrator, anything else follows the actor id. */
export function auditActor(actorId: number | null, memberUserId: number, action?: string): TimelineActor {
  if (action?.startsWith('member.')) return 'user';
  if (action?.startsWith('admin.')) return 'administrator';
  if (actorId === null) return 'server';
  return actorId === memberUserId ? 'user' : 'administrator';
}

const AUDIT_LABELS: Record<string, string> = {
  'account.onboarding.completed': 'Finished onboarding',
  'account.session.signed_in': 'Signed in',
  'account.session.signed_out': 'Signed out',
  'member.marketing_preference.changed': 'Changed their email-update preference',
  'member.profile.created': 'Created their member profile',
  'account.migration_activation.completed': 'Account activated',
  'account.migration_activation.delivery_queued': 'Activation email queued',
  'account.migration_activation.delivery_succeeded': 'Activation email handed to Brevo',
  'account.migration_activation.reconciliation_required': 'Activation blocked: imported record incomplete',
  'account.password_reset.completed': 'Password reset completed',
  'account.password_reset.delivery_queued': 'Password-reset email queued',
  'account.password_reset.delivery_succeeded': 'Password-reset email handed to Brevo',
  'auth.legacy_password.breach_check_unavailable': 'Old password accepted; breach check unavailable',
  'admin.seminar_registration.approval_status_changed': 'FEI approval status changed',
  'admin.seminar_registration.created': 'Registered for a seminar (by an administrator)',
  'admin.seminar_registration.details_updated': 'Seminar registration details updated',
  'admin.seminar_registration.payment_marked_paid': 'Seminar payment marked as paid',
  'admin.seminar_registration.status_changed': 'Seminar registration status changed',
  'member.seminar_registration.canceled': 'Canceled a seminar registration',
  'member.seminar_registration.registered': 'Registered for a seminar',
};

export function auditTitle(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  const words = action.replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export type BrevoTimelineEvent = { at: string; event: string; link?: string; reason?: string; subject?: string };

/** Brevo reports what happened to a message. A person opening it or clicking in it is the member; everything else
 * (accepted, delivered, bounced, blocked, deferred) is the mail system. Link query strings are dropped: they can carry a one-time token. */
export function brevoEntry(event: BrevoTimelineEvent, index: number): TimelineEntry {
  const subject = event.subject ? `“${event.subject}”` : 'an email';
  const base = { at: event.at, category: 'Email', id: `brevo-${index}`, source: 'brevo' as const };
  switch (event.event) {
    case 'opened': return { ...base, actor: 'user', title: `Opened ${subject}` };
    case 'clicks': return { ...base, actor: 'user', detail: safeLink(event.link), title: `Clicked a link in ${subject}` };
    case 'delivered': return { ...base, actor: 'server', title: `Brevo delivered ${subject}` };
    case 'requests': return { ...base, actor: 'server', title: `Brevo accepted ${subject} for sending` };
    case 'hardBounces': return { ...base, actor: 'server', detail: event.reason, title: `Brevo reports a hard bounce for ${subject}` };
    case 'softBounces': return { ...base, actor: 'server', detail: event.reason, title: `Brevo reports a soft bounce for ${subject}` };
    case 'blocked': return { ...base, actor: 'server', detail: event.reason, title: `Brevo blocked ${subject}` };
    case 'invalid': return { ...base, actor: 'server', detail: event.reason, title: `Brevo rejected the address for ${subject}` };
    case 'deferred': return { ...base, actor: 'server', detail: event.reason, title: `Brevo deferred ${subject} (will retry)` };
    case 'spam': return { ...base, actor: 'user', title: `Marked ${subject} as spam` };
    case 'error': return { ...base, actor: 'server', detail: event.reason, title: `Brevo reported an error for ${subject}` };
    default: return { ...base, actor: 'server', title: `Brevo event “${event.event}” for ${subject}` };
  }
}

/** Host and path only. */
export function safeLink(link: string | undefined): string | undefined {
  if (!link) return undefined;
  try { const url = new URL(link); return `${url.origin}${url.pathname}`; } catch { return undefined; }
}

export function sortTimeline(entries: TimelineEntry[], direction: 'asc' | 'desc' = 'asc'): TimelineEntry[] {
  const sign = direction === 'asc' ? 1 : -1;
  return [...entries].sort((left, right) => sign * (Date.parse(left.at) - Date.parse(right.at)) || left.id.localeCompare(right.id));
}

/** Keeps only events inside the requested range (inclusive ISO bounds), however many timestamps the source record carries. */
export function withinRange(entries: TimelineEntry[], fromIso: string, toIso: string): TimelineEntry[] {
  return entries.filter((entry) => entry.at >= fromIso && entry.at <= toIso);
}

/** Audit rows that repeat a fact another source already shows in more detail (the payment row carries the amount; the email-queue
 * rows carry queued/sent/failed), so the timeline does not list the same event twice. A row is skipped only when the source that
 * replaces it was actually read; otherwise the audit entry stays as the evidence. */
export function auditDuplicatesAnotherSource(action: string, loaded: { accountEmails: boolean; payments: boolean }): boolean {
  if (action === 'admin.payment.recorded') return loaded.payments;
  return loaded.accountEmails && /^account\.[a-z_]+\.delivery_(queued|succeeded)$/.test(action);
}

export const ACCOUNT_STATE_LABELS: Record<string, string> = {
  active: 'Active',
  deleted: 'Deleted',
  migrated_pending: 'Imported from the old site, not yet activated',
  onboarding: 'Signed up, finishing onboarding',
  suspended: 'Suspended',
  unverified: 'Email not yet verified',
};

/** The account's own life story, shown in the drawer's Account history panel whether or not it falls inside the date range.
 * For an imported member `users.created_at` is the date they registered on the old site (the import preserves it), and the profile's
 * `created_at` is when the import ran; for everyone else `users.created_at` is when they signed up here. */
export function accountMilestones(input: { accountState: string; emailVerifiedAt: string | null; legacyWpUserId: number | null; profileCreatedAt: string; userCreatedAt: string }): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const base = { category: 'Account', source: 'idoc' as const };
  if (input.legacyWpUserId !== null) {
    entries.push({ ...base, actor: 'user', at: input.userCreatedAt, detail: 'Date from the old site (time of day not recorded)', id: 'milestone-registered-old-site', title: 'Registered on the old site' });
    entries.push({ ...base, actor: 'administrator', at: input.profileCreatedAt, detail: `Old-site user #${input.legacyWpUserId}`, id: 'milestone-imported', title: 'Imported into the new site' });
  } else {
    entries.push({ ...base, actor: 'user', at: input.userCreatedAt, id: 'milestone-created', title: 'Created their account on the new site' });
  }
  if (input.emailVerifiedAt) entries.push({ ...base, actor: 'user', at: input.emailVerifiedAt, id: 'milestone-email-verified', title: 'Verified their email address' });
  return sortTimeline(entries, 'asc');
}
