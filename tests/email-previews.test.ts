import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const previewDefinitions = readFileSync('lib/notifications/email-previews.ts', 'utf8');
const previewPage = readFileSync('app/(dashboard)/admin/email-previews/page.tsx', 'utf8');
const previewAction = readFileSync('app/(dashboard)/admin/email-previews/actions.ts', 'utf8');
const previewForm = readFileSync('app/(dashboard)/admin/email-previews/preview-send-form.tsx', 'utf8');
const registrationEmail = readFileSync('lib/seminars/registrations.ts', 'utf8');

test('registration confirmations cover FEI and non-FEI scenarios using the real email renderer', () => {
  assert.match(previewDefinitions, /seminar\.registration_created_non_fei/);
  assert.match(previewDefinitions, /seminarRegistrationConfirmationBodyHtml\(/);
  assert.match(previewDefinitions, /approvalStatus: 'confirmed', isFei: false/);
  assert.match(previewDefinitions, /approvalStatus: 'pending_fei_approval', isFei: true/);
  assert.match(registrationEmail, /Your National Federation must register you with the FEI/);
  assert.match(registrationEmail, /Registering with IDOC alone does not approve you to participate/);
});

test('all four FEI approval statuses are previewable as actual status updates', () => {
  for (const status of [
    'pending_fei_approval',
    'approved_by_fei',
    'not_approved_by_fei',
    'approved_audit_only_by_fei',
  ]) {
    assert.match(previewDefinitions, new RegExp(status));
  }
  assert.match(previewDefinitions, /statusUpdate: true/);
  assert.match(previewDefinitions, /APPROVAL_STATUS_LABELS\[approvalStatus\]/);
});

test('seminar payment and refund notices are previewed without processing transactions', () => {
  assert.match(previewDefinitions, /seminar\.payment_confirmed/);
  assert.match(previewDefinitions, /seminar\.refund_confirmed/);
  assert.match(previewDefinitions, /renderNotice\(id,/);
  assert.doesNotMatch(previewDefinitions, /stripe\.refunds\.create|createRefund/);
});

test('preview send action remains server-authorized, CSRF-protected and navigation-free', () => {
  assert.match(previewAction, /requireCsrfToken\(/);
  assert.match(previewAction, /requireSuperAdmin\(/);
  assert.match(previewAction, /requireAccountAccess\('administration'\)/);
  assert.match(previewAction, /rawCanonicalSessionId\(\)/);
  assert.match(previewAction, /rawCanonicalUserId\(\)/);
  assert.match(previewAction, /process\.env\.VERCEL_ENV === 'production'/);
  assert.doesNotMatch(previewAction, /redirect\(/);
  assert.match(previewAction, /await sendEmailPreview\(id\)/);
  assert.match(previewPage, /PreviewSendForm/);
});

test('each preview button has a pending state and inline delivery feedback', () => {
  assert.match(previewForm, /useActionState/);
  assert.match(previewForm, /disabled=\{pending\}/);
  assert.match(previewForm, /aria-busy=\{pending\}/);
  assert.match(previewForm, /Sending…/);
  assert.match(previewForm, /aria-live="polite"/);
});
