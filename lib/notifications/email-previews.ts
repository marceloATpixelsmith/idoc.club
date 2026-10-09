import 'server-only';

import { EMAIL_OTP_SUBJECTS, renderEmailOtpHtml, type EmailOtpPurpose } from '@/lib/auth/email-otp';
import { AUTH_SECURITY_CONTENT } from '@/lib/notifications/auth-security-delivery';
import { AUTH_SECURITY_KINDS } from '@/lib/notifications/auth-security-events';
import { sendTransactionalEmail } from '@/lib/notifications/brevo-transactional';
import { emailButton, escapeHtml, renderGuestSeminarRefundEmail, renderTransactionalEmail } from '@/lib/notifications/email-template';
import { renderNotice } from '@/lib/notifications/renewal-notices';
import { seminarRegistrationConfirmationBodyHtml, type SeminarEmailDetails } from '@/lib/seminars/registrations';
import { formatDateTime } from '@/lib/format';

export const EMAIL_PREVIEW_RECIPIENT = 'zangfuqi@gmail.com';

export type EmailPreviewDefinition = {
  category: 'Account & authentication' | 'Security' | 'Membership & billing' | 'Seminars';
  id: string;
  label: string;
};

const OTP_PURPOSES: { label: string; purpose: EmailOtpPurpose }[] = [
  { label: 'Google disconnect verification code', purpose: 'google_disconnect_verification' },
  { label: 'Sign-in verification code', purpose: 'login_verification' },
  { label: 'Password reset code', purpose: 'password_reset' },
  { label: 'Signup verification code', purpose: 'signup_verification' },
];

const MEMBERSHIP_PREVIEWS = [
  ['membership.renewal_reminder', 'Automatic renewal reminder'],
  ['membership.expiration_reminder', 'Membership expiration reminder'],
  ['membership.payment_failed', 'Renewal payment failed'],
  ['membership.grace_reminder', 'Grace-period reminder'],
  ['membership.grace_expired', 'Membership expired after grace'],
] as const;

const SEMINAR_PREVIEWS = [
  ['seminar.registration_created', 'Seminar registration confirmation'],
  ['seminar.registration_canceled', 'Seminar registration canceled'],
  ['seminar.payment_confirmed', 'Seminar payment confirmed'],
  ['seminar.refund_confirmed', 'Member seminar refund confirmed'],
  ['seminar.guest_refund_confirmed', 'Guest seminar refund confirmed'],
] as const;

export const EMAIL_PREVIEW_DEFINITIONS: EmailPreviewDefinition[] = [
  ...OTP_PURPOSES.map(({ label, purpose }) => ({ category: 'Account & authentication' as const, id: `otp:${purpose}`, label })),
  { category: 'Account & authentication', id: 'account:migration_activation', label: 'Imported-account activation' },
  { category: 'Account & authentication', id: 'account:password_reset_link', label: 'Password reset link' },
  { category: 'Account & authentication', id: 'account:verify_email', label: 'Verify changed email address' },
  ...AUTH_SECURITY_KINDS.map((kind) => ({ category: 'Security' as const, id: `security:${kind}`, label: AUTH_SECURITY_CONTENT[kind].heading })),
  ...MEMBERSHIP_PREVIEWS.map(([id, label]) => ({ category: 'Membership & billing' as const, id, label })),
  ...SEMINAR_PREVIEWS.map(([id, label]) => ({ category: 'Seminars' as const, id, label })),
];

function previewSubject(subject: string) {
  return `[PREVIEW] ${subject}`;
}

function accountLinkPreview(kind: 'migration_activation' | 'password_reset_link') {
  const activation = kind === 'migration_activation';
  const url = activation
    ? 'https://staging.idoc.club/activate?token=preview-token-not-valid'
    : 'https://staging.idoc.club/reset-password?token=preview-token-not-valid';
  return {
    html: renderTransactionalEmail({
      bodyHtml: emailButton(url, activation ? 'Activate your imported IDOC account' : 'Reset your password'),
      footerNote: 'If you did not request this, you can safely ignore this email.',
      heading: activation ? 'Activate your account' : 'Reset your password',
    }),
    subject: activation ? 'Activate your IDOC account' : 'Reset your IDOC password',
  };
}

function emailChangePreview() {
  const url = 'https://staging.idoc.club/verify-email?token=preview-token-not-valid';
  return {
    html: renderTransactionalEmail({
      bodyHtml: `<p>Confirm this is your new email address for your IDOC account.</p>${emailButton(url, 'Verify email')}`,
      footerNote: 'If you did not request this change, you can safely ignore this email.',
      heading: 'Verify your email address',
    }),
    subject: 'Verify your IDOC email address',
  };
}

function securityPreview(kind: (typeof AUTH_SECURITY_KINDS)[number]) {
  const message = AUTH_SECURITY_CONTENT[kind];
  const timestamp = formatDateTime(new Date().toISOString());
  return {
    html: renderTransactionalEmail({
      heading: message.heading,
      bodyHtml: `<p>${escapeHtml(message.heading)} on ${escapeHtml(timestamp)}. If you did not make or authorize this change, contact IDOC immediately.</p>`,
      footerNote: 'This is a security notification for your IDOC account.',
    }),
    subject: message.subject,
  };
}

const SAMPLE_SEMINAR: SeminarEmailDetails = {
  accommodation_information: '<p>Accommodation information appears here exactly as seminar rich text is rendered.</p>',
  application: '<p>Application instructions and any required steps appear here.</p>',
  capacity: 30,
  course_directors: '<p>Sample Course Director</p>',
  course_venue_information: '<p>Sample Dressage Centre, Madrid, Spain</p>',
  end_date: '2026-11-16',
  is_fei: true,
  language: 'en',
  levels: ['level_1', 'level_2'],
  location: 'Madrid, Spain',
  member_price_cents: 12000,
  non_member_price_cents: 18000,
  organizing_national_federation: 'ES',
  participant_profile: '<p>Judges, Stewards and Veterinarians.</p>',
  registration_deadline: '2026-11-01',
  start_date: '2026-11-15',
  title: 'Sample IDOC Dressage Seminar',
};

async function seminarRegistrationPreview() {
  return {
    html: renderTransactionalEmail({
      bodyHtml: await seminarRegistrationConfirmationBodyHtml({
        amountCents: 18000,
        firstName: 'Ameyalli',
        paymentConfirmed: true,
        paymentMethod: 'online_stripe',
        seminar: SAMPLE_SEMINAR,
      }),
      heading: `Thank you for registering for ${escapeHtml(SAMPLE_SEMINAR.title)}`,
    }),
    subject: 'Your IDOC seminar registration',
  };
}

async function renderPreview(id: string): Promise<{ html: string; subject: string }> {
  if (id.startsWith('otp:')) {
    const purpose = id.slice(4) as EmailOtpPurpose;
    if (!OTP_PURPOSES.some((entry) => entry.purpose === purpose)) throw new Error('Unknown preview.');
    return { html: renderEmailOtpHtml('482731', purpose), subject: EMAIL_OTP_SUBJECTS[purpose] };
  }
  if (id === 'account:migration_activation') return accountLinkPreview('migration_activation');
  if (id === 'account:password_reset_link') return accountLinkPreview('password_reset_link');
  if (id === 'account:verify_email') return emailChangePreview();
  if (id.startsWith('security:')) {
    const kind = id.slice(9) as (typeof AUTH_SECURITY_KINDS)[number];
    if (!(AUTH_SECURITY_KINDS as readonly string[]).includes(kind)) throw new Error('Unknown preview.');
    return securityPreview(kind);
  }
  if (id === 'seminar.registration_created') return seminarRegistrationPreview();
  if (id === 'seminar.guest_refund_confirmed') return renderGuestSeminarRefundEmail('Ameyalli');
  if (MEMBERSHIP_PREVIEWS.some(([kind]) => kind === id) || SEMINAR_PREVIEWS.some(([kind]) => kind === id)) {
    return renderNotice(id, {
      amountCents: 18000,
      expirationDate: '2026-12-31',
      firstName: 'Ameyalli',
      graceEndDate: '2026-11-20',
      renewalDate: '2026-11-15',
    });
  }
  throw new Error('Unknown preview.');
}

export async function sendEmailPreview(id: string) {
  const rendered = await renderPreview(id);
  await sendTransactionalEmail({
    html: rendered.html,
    messageId: `preview-${id.replace(/[^a-z0-9]+/gi, '-')}-${Date.now()}`,
    subject: previewSubject(rendered.subject),
    to: EMAIL_PREVIEW_RECIPIENT,
  });
}

export type EmailPreviewSendResult = {
  id: string;
  label: string;
  status: 'failed' | 'sent';
};

export async function sendAllEmailPreviews(): Promise<EmailPreviewSendResult[]> {
  const results: EmailPreviewSendResult[] = [];
  for (const preview of EMAIL_PREVIEW_DEFINITIONS) {
    try {
      await sendEmailPreview(preview.id);
      results.push({ id: preview.id, label: preview.label, status: 'sent' });
    } catch {
      results.push({ id: preview.id, label: preview.label, status: 'failed' });
    }
  }
  return results;
}
