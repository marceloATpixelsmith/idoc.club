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
export function timelineRange(from: string | null | undefined, to: string | null | undefined, now: Date = new Date(), all = false): { from: Date; fromKey: string; to: Date; toKey: string } {
  const todayKey = now.toISOString().slice(0, 10);
  // "All dates" (the date filter cleared) reaches back past any account; each source is still capped by its row limit.
  if (all) return { from: new Date('2000-01-01T00:00:00Z'), fromKey: '2000-01-01', to: new Date(Date.parse(`${todayKey}T00:00:00Z`) + DAY_MS - 1), toKey: todayKey };
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

/** Brevo's event log only reaches back a limited time, so its query starts no earlier than this many days ago; null when the whole
 * range is older (nothing to ask for). */
export const BREVO_WINDOW_DAYS = 90;
export function brevoWindowStart(fromKey: string, toKey: string, now: Date = new Date()): string | null {
  const earliest = new Date(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`) - BREVO_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const start = fromKey > earliest ? fromKey : earliest;
  return start > toKey ? null : start;
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
  'account.deleted': 'Their account was deleted',
  'account.email.verified': 'Verified their email address',
  'account.migration_activation.completed': 'Activated their account by choosing a new password',
  'account.migration_activation.reconciliation_required': 'Activation was blocked: the imported record is incomplete and needs an administrator',
  'account.onboarding.completed': 'Finished setting up their profile',
  'account.password.changed': 'Changed their password',
  'account.password.created': 'Created a password',
  'account.password_reset.completed': 'Reset their password using the link from their email',
  'account.session.signed_in': 'Signed in',
  'account.session.signed_out': 'Signed out',
  'admin.account.authority_force_revoked': 'An administrator signed them out everywhere and removed their access rights',
  'admin.account.reinstated': 'An administrator let them sign in again',
  'admin.account.suspended': 'An administrator blocked them from signing in',
  'admin.member.archived': 'An administrator archived this member',
  'admin.member.authored_content_reassigned': 'An administrator handed their articles and content to someone else',
  'admin.member.permanently_deleted': 'An administrator permanently deleted this member',
  'admin.membership.canceled': 'An administrator canceled their membership',
  'admin.membership.corrected': 'An administrator corrected their membership dates or status',
  'admin.membership.expiration_extended': 'An administrator extended their membership expiration date',
  'admin.membership.reinstated': 'An administrator reinstated their membership',
  'admin.membership_payment.refund_requested': 'An administrator started a refund of a membership payment',
  'admin.payment.recorded': 'An administrator recorded a payment',
  'admin.profile.updated': 'An administrator edited their profile',
  'admin.role.granted': 'An administrator gave them a role',
  'admin.role.revoked': 'An administrator removed a role from them',
  'admin.seminar_payment.refund_requested': 'An administrator started a refund of a seminar payment',
  'admin.seminar_registration.approval_status_changed': 'An administrator changed their FEI approval status for a seminar',
  'admin.seminar_registration.created': 'An administrator registered them for a seminar',
  'admin.seminar_registration.deleted': 'An administrator deleted their seminar registration',
  'admin.seminar_registration.details_updated': 'An administrator edited their seminar registration',
  'admin.seminar_registration.payment_marked_paid': 'An administrator marked their seminar payment as paid',
  'admin.seminar_registration.status_changed': 'An administrator changed their seminar registration status',
  'auth.breached_password_rejected': 'Tried a password that appears in a known data breach, so it was refused',
  'auth.google_identity.linked': 'Connected their Google account',
  'auth.google_identity.unlinked': 'Disconnected their Google account',
  'auth.legacy_password.breach_check_unavailable': 'Signed in with their old-site password; the breach check could not run',
  'auth.mfa.authenticator.enrolled': 'Set up an authenticator app',
  'auth.mfa.authenticator.replaced': 'Replaced their authenticator app',
  'auth.mfa.compromised_key_rejected': 'An authenticator setup was refused because the key was unsafe',
  'auth.mfa.recovery_code.rejected': 'Entered a recovery code that was not valid',
  'auth.mfa.recovery_code.used': 'Used a recovery code to sign in',
  'auth.mfa.recovery_codes.regenerated': 'Generated a new set of recovery codes',
  'member.marketing_preference.changed': 'Changed their email-updates preference',
  'member.membership_canceled': 'Canceled their own membership',
  'member.profile.completed_after_import': 'Completed their profile after being imported',
  'member.profile.created': 'Created their member profile',
  'member.profile.updated': 'Updated their profile',
  'member.seminar_registration.canceled': 'Canceled their seminar registration',
  'member.seminar_registration.registered': 'Registered for a seminar',
  'membership.renewal_change_authorized': 'Confirmed a change to how their membership renews',
  'membership.renewal_change_cancelled': 'Canceled a pending change to how their membership renews',
  'membership.renewal_change_requested': 'Asked to change how their membership renews',
  'stripe.customer_email_sync': 'The server updated their email address at Stripe (our payment provider)',
  'stripe.customer_email_sync.completed': 'The server finished updating their email address at Stripe (our payment provider)',
  'stripe.customer_email_sync.dead_lettered': 'The server could not update their email address at Stripe (our payment provider) and gave up',
  'support.assignment.changed': 'A support conversation of theirs was reassigned to another administrator',
  'support.conversation.closed': 'A support conversation of theirs was closed',
  'support.conversation.reopened': 'A support conversation of theirs was reopened',
};

/** Plain-English title for an audit-trail action. Anything not listed gets a readable version of its code, marked as a system record. */
export function auditTitle(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  const words = action.replace(/[._]+/g, ' ').trim();
  return `System record: ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
}

const SECURITY_NOTICE_LABELS: Record<string, string> = {
  authenticator_enrolled: 'authenticator app set up',
  google_identity_linked: 'Google account connected',
  google_identity_unlinked: 'Google account disconnected',
  legacy_welcome: 'welcome email for imported members',
  new_sign_in: 'new sign-in',
  password_changed: 'password changed',
  password_reset_completed: 'password reset',
  verified_email_changed: 'email address changed',
};
export function securityNoticeLabel(kind: string): string {
  return `Security alert email (${SECURITY_NOTICE_LABELS[kind] ?? kind.replace(/_/g, ' ')})`;
}

const OTP_PURPOSE_LABELS: Record<string, string> = {
  google_disconnect_verification: 'code to disconnect their Google account',
  login_verification: 'sign-in code',
  password_reset: 'password-reset code',
  signup_verification: 'sign-up code',
};
export function otpPurposeLabel(purpose: string): string {
  return OTP_PURPOSE_LABELS[purpose] ?? `${purpose.replace(/_/g, ' ')} code`;
}

const ERROR_CODE_LABELS: Record<string, string> = {
  member_launch_hold: 'Member emails are switched off in this environment, so it was not sent',
  token_ineligible: 'The link was no longer valid when the server tried to send it',
};
export function errorCodeLabel(code: string | undefined): string | undefined {
  return code ? ERROR_CODE_LABELS[code] ?? `Reason code: ${code}` : undefined;
}

/** The four steps an email goes through on our side, worded the same way for every kind of email. */
export function emailStepTitles(label: string): { cancelled: string; failed: string; queued: string; sent: string } {
  return {
    cancelled: `Email cancelled before it was sent: ${label}`,
    failed: `Email could not be sent and the server gave up: ${label}`,
    queued: `Email waiting to be sent: ${label}`,
    sent: `Email handed to our email service (Brevo): ${label}`,
  };
}

export type BrevoTimelineEvent = { at: string; event: string; link?: string; reason?: string; subject?: string };

/** Brevo is our email service. It reports what happened to each message. A person opening it or clicking in it is the member; the rest
 * (accepted, delivered, bounced, blocked, deferred) is the mail system. Link query strings are dropped: they can carry a one-time token. */
export function brevoEntry(event: BrevoTimelineEvent, index: number): TimelineEntry {
  const subject = event.subject ? `“${event.subject}”` : 'an email';
  const base = { at: event.at, category: 'Email', id: `brevo-${index}`, source: 'brevo' as const };
  switch (event.event) {
    case 'requests': return { ...base, actor: 'server', title: `Our email service (Brevo) accepted ${subject} for sending` };
    case 'delivered': return { ...base, actor: 'server', title: `${subject} reached their mail provider (delivered)` };
    case 'opened': case 'uniqueOpened': return { ...base, actor: 'user', title: `Opened ${subject}` };
    case 'loadedByProxy': return { ...base, actor: 'user', detail: 'Their mail app loads emails automatically (Apple Mail and Gmail do this), so this does not prove they read it.', title: `Their mail app automatically loaded ${subject}` };
    case 'clicks': return { ...base, actor: 'user', detail: safeLink(event.link), title: `Clicked a link in ${subject}` };
    case 'hardBounces': return { ...base, actor: 'server', detail: event.reason, title: `${subject} bounced for good: the address does not exist or refuses mail` };
    case 'softBounces': return { ...base, actor: 'server', detail: event.reason, title: `${subject} bounced for now (for example a full mailbox); it may be retried` };
    case 'blocked': return { ...base, actor: 'server', detail: event.reason, title: `${subject} was blocked and not delivered` };
    case 'invalid': return { ...base, actor: 'server', detail: event.reason, title: `${subject} was rejected because the address is not valid` };
    case 'deferred': return { ...base, actor: 'server', detail: event.reason, title: `Delivery of ${subject} was delayed; it will be retried` };
    case 'spam': return { ...base, actor: 'user', title: `Marked ${subject} as spam` };
    case 'unsubscribed': return { ...base, actor: 'user', title: `Unsubscribed from emails using ${subject}` };
    case 'error': return { ...base, actor: 'server', detail: event.reason, title: `Our email service reported an error for ${subject}` };
    default: return { ...base, actor: 'server', title: `Our email service reported “${event.event}” for ${subject}` };
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
    if (input.emailVerifiedAt) entries.push({ ...base, actor: 'user', at: input.emailVerifiedAt, id: 'milestone-email-verified', title: 'Verified their email address when activating' });
  } else {
    // Signing up verifies the email first and then creates the account a fraction of a second later, so the two are one step here.
    entries.push({ ...base, actor: 'user', at: input.userCreatedAt, detail: input.emailVerifiedAt ? 'Their email address was verified as part of signing up' : undefined, id: 'milestone-created', title: 'Created their account on the new site' });
  }
  return sortTimeline(entries, 'asc');
}

/** UTC time of day to the millisecond (HH:MM:SS.mmm), because events can happen within the same second. */
export function formatTimelineTime(iso: string): string {
  return iso.slice(11, 23);
}
