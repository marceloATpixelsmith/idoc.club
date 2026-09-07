import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { formatOrganizationAddress, hasVisibleBankInstructions, sanitizeBankInstructions } from '../lib/organization/format.ts';

test('partial and missing organization addresses format cleanly', () => {
  assert.deepEqual(formatOrganizationAddress({ address1: 'Main Street 1', address2: null, city: 'Brussels', country: 'Belgium', postalCode: null, stateProvince: null }), ['Main Street 1', 'Brussels', 'Belgium']);
  assert.deepEqual(formatOrganizationAddress(null), []);
});

test('bank instructions retain basic rich text and remove active content', () => {
  const value = sanitizeBankInstructions('<p onclick="steal()"><strong>Pay</strong> <a href="javascript:steal()">here</a></p><script>alert(1)</script><iframe src=x>bad</iframe>');
  assert.equal(value, '<p><strong>Pay</strong> <a>here</a></p>');
  assert.doesNotMatch(value, /javascript|onclick|script|iframe|alert/i);
});

test('entity-encoded and Unicode whitespace do not satisfy required bank instructions', () => {
  for (const value of ['<p>&nbsp;</p>', '<p>&#160;</p>', '<p>&#xA0;</p>', '<p>\u200b</p>', '<p><br></p>']) {
    assert.equal(hasVisibleBankInstructions(sanitizeBankInstructions(value)), false, value);
  }
  assert.equal(hasVisibleBankInstructions(sanitizeBankInstructions('<p>Transfer to the account shown.</p>')), true);
  assert.equal(hasVisibleBankInstructions(sanitizeBankInstructions('<p>&amp;</p>')), true);
});

test('saving settings revalidates every public address surface', () => {
  const action = readFileSync(new URL('../app/(dashboard)/admin/organization/actions.ts', import.meta.url), 'utf8');
  assert.match(action, /revalidatePath\('\/', 'layout'\)/);
  assert.match(action, /revalidatePath\('\/contact'\)/);
  assert.ok(action.indexOf('await updateOrganizationSettings') < action.indexOf("revalidatePath('/', 'layout')"));
});

test('migration idempotently seeds protected canonical identities', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0038_organization_settings.sql', import.meta.url), 'utf8');
  assert.match(migration, /ON CONFLICT \("canonical_id"\) DO NOTHING/);
  assert.match(migration, /"canonical_id" <> 'online_stripe' OR \("enabled" AND "system_protected"/);
  assert.match(migration, /BEFORE DELETE ON "idoc"\."seminar_payment_methods"/);
});
