import 'server-only';

import { memberCommunicationsDisabled } from '@/lib/runtime/member-launch-hold';
import { baseUrlForServer } from '@/lib/runtime/configuration';
import { emailButton, escapeHtml, renderTransactionalEmail } from './email-template';
import { taggedSubject } from './alert-severity';
import { enqueueOperationalAlert } from './operational-alert-outbox';
import { scanMemberJourneyConcerns, type MemberJourneyConcernKind } from './member-journey-health';

const LABELS: Record<MemberJourneyConcernKind, string> = {
  activation_repeated: 'Repeated activation link requests',
  activation_delivery_stuck: 'Activation email not sent',
  login_code_repeated: 'Repeated sign-in codes without a successful login',
  onboarding_incomplete: 'Onboarding incomplete',
  renewal_delivery_stuck: 'Renewal notice not sent',
  renewal_followup: 'Renewal follow-up due',
};

export async function runMemberJourneyWatch(now = new Date()) {
  // COMMUNICATION HOLDS MUST NOT GENERATE FALSE ALERTS FOR DELIBERATELY HELD EMAILS.
  if (memberCommunicationsDisabled()) return { alerted: false, concerns: 0, held: true };
  const issues = await scanMemberJourneyConcerns(now);
  if (issues.length === 0) return { alerted: false, concerns: 0, held: false };

  // SEND ONE RE-TRIABLE DIGEST PER UTC DAY, NOT ONE EMAIL EVERY FIVE MINUTES OR
  // ONE EMAIL FOR EVERY AFFECTED MEMBER. ALL DETAILS REMAIN ON THE ADMIN DASHBOARD.
  const urgent = issues.some((issue) => issue.kind === 'activation_delivery_stuck'
    || issue.kind === 'login_code_repeated' || issue.kind === 'renewal_delivery_stuck');
  const summary = Object.keys(LABELS).flatMap((key) => {
    const count = issues.filter((issue) => issue.kind === key).length;
    return count ? [`<li><strong>${escapeHtml(LABELS[key as MemberJourneyConcernKind])}:</strong> ${count}</li>`] : [];
  }).join('');
  const rows = issues.slice(0, 20).map((issue) =>
    `<li><strong>${escapeHtml(issue.member)}:</strong> ${escapeHtml(issue.email)} — ${escapeHtml(LABELS[issue.kind])} (${issue.count})</li>`,
  ).join('');
  const url = new URL('/admin', baseUrlForServer()).toString();
  const bodyHtml = `<p>${issues.length} current journey concern(s) need review. These are observed signals, not proof of an email failure or a member's intentions.</p><ul>${summary}</ul><p>Recent affected accounts:</p><ul>${rows}</ul>${issues.length > 20 ? '<p>More concerns are listed in the administrator dashboard.</p>' : ''}${emailButton(url, 'Review member journey health')}`;
  const inserted = await enqueueOperationalAlert({
    bodyHtml: renderTransactionalEmail({ bodyHtml, heading: 'Member journey health', footerNote: 'One digest per UTC day. Repeated login or activation requests can be reported even when email transport reports delivery.' }),
    dedupeKey: `member-journey-digest:${now.toISOString().slice(0, 10)}`,
    kind: 'member_journey_attention',
    subject: taggedSubject(urgent ? 'member.journey_urgent' : 'member.journey_followup', `IDOC: ${issues.length} member journey concern(s)`),
  });
  return { alerted: inserted, concerns: issues.length, held: false };
}
