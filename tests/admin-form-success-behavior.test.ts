import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const memberDetailSheet = readFileSync('app/(dashboard)/admin/members/member-detail-sheet.tsx', 'utf8');
const successAwareForms = [
  'app/(dashboard)/admin/members/admin-profile-form.tsx',
  'app/(dashboard)/admin/members/entitlement-correction-form.tsx',
  'app/(dashboard)/admin/members/extend-expiration-form.tsx',
  'app/(dashboard)/admin/members/membership-status-form.tsx',
  'app/(dashboard)/admin/members/account-suspension-form.tsx',
  'app/(dashboard)/admin/members/roles-section.tsx',
  'app/(dashboard)/admin/payments/manual-payment-form.tsx',
  'app/(dashboard)/admin/payments/refund-form.tsx',
].map((path) => ({ path, source: readFileSync(path, 'utf8') }));

test('every mutating member admin form closes the sheet and refreshes the table on success', () => {
  assert.match(memberDetailSheet, /const closeAndRefresh = useCallback\(\(\) => \{ setOpen\(false\); router\.push\(closeHref\); router\.refresh\(\); \}, \[closeHref, router\]\);/);

  const expectedBindings = [
    'AdminProfileForm',
    'ExtendExpirationForm',
    'EntitlementCorrectionForm',
    'ReinstateForm',
    'SuspendForm',
    'ManualPaymentForm',
    'MembershipRefundForm',
    'ReinstateAccountForm',
    'SuspendAccountForm',
    'RolesSection',
    'ForceRevokeAllAuthorityForm',
  ];

  for (const component of expectedBindings) {
    assert.match(memberDetailSheet, new RegExp(`<${component}[^>]*onSuccess=\\{closeAndRefresh\\}`));
  }
});

// This regression test intentionally covers UI completion behavior only; auth/security semantics are unchanged.
test('member admin mutation forms invoke their success callback only after a successful action result', () => {
  for (const { path, source } of successAwareForms) {
    assert.match(source, /onSuccess\?: \(\) => void/, `${path} must accept an onSuccess callback`);
    assert.match(source, /state\.success|grantState\.success|revokeState\.success/, `${path} must react to successful action state`);
    assert.match(source, /onSuccess\?\.\(\)/, `${path} must invoke the shared completion callback`);
  }
});


test('membership suspension keeps the drawer open when Stripe cancellation needs manual attention', () => {
  const actions = readFileSync('app/(dashboard)/admin/members/actions.ts', 'utf8');
  const form = readFileSync('app/(dashboard)/admin/members/membership-status-form.tsx', 'utf8');
  assert.match(actions, /attentionRequired: true/);
  assert.match(form, /state\.success && !state\.attentionRequired/);
  assert.match(form, /text-amber-600/);
});
