import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMissingWordPressUserMapping } from '../lib/membership/legacy-import.ts';

const synthetic = {
  email: 'synthetic-member@example.invalid', identitySource: 'stripe_live_verified',
  memberpressUserId: '900001', paidThrough: '2027-01-01',
  profile: { address1: null, address2: null, city: null, countryCode: null, firstName: null,
    lastName: null, postalCode: null, stateProvince: null },
  stripeSubscriptionId: 'sub_syntheticExactMapping001',
};

test('missing WordPress rows require exact verified subscription evidence and preserve absent profile values', () => {
  assert.deepEqual(validateMissingWordPressUserMapping(synthetic).profile, synthetic.profile);
  assert.throws(() => validateMissingWordPressUserMapping({ ...synthetic, stripeSubscriptionId: undefined }));
  assert.throws(() => validateMissingWordPressUserMapping({ ...synthetic, identitySource: 'email_guess' }));
  assert.throws(() => validateMissingWordPressUserMapping({ ...synthetic, profile: { ...synthetic.profile, firstName: 'Invented' }, extra: 'pii' }));
});
