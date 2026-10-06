import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('legacy review is a durable server-side gate completed only by the canonical profile mutation', () => {
  const data = read('lib/membership/data-access.ts');
  const page = read('app/(dashboard)/dashboard/page.tsx');
  const form = read('app/(dashboard)/dashboard/profile/profile-form.tsx');
  assert.match(data, /account\.legacyProfileReviewRequired[\s\S]*profile_review/);
  assert.match(data, /getOwnLegacyProfileReviewData[\s\S]*profile_review/);
  assert.match(data, /account\.legacyProfileReviewRequired && !isPrivilegedActor\(actor\)[\s\S]*account\.accountState !== 'active'[\s\S]*!\['account', 'profile_review'\]\.includes\(operation\)/);
  assert.match(data, /account\.accountState !== 'active'/);
  assert.match(data, /legacyProfileReviewRequired: false, legacyProfileReviewedAt: now/);
  assert.match(data, /resetLegacyProfileReview[\s\S]*requireAdministrator/);
  assert.match(page, /legacyProfileReviewRequired[\s\S]*dashboard\/profile\?confirmDetails=1/);
  for (const field of ['nationalFederationCountryCode', 'idocRegion', 'feiId', 'judgeStatus', 'stewardStatus', 'isTechnicalDelegate']) {
    assert.match(form, new RegExp(`name=["'{].*${field}|name="${field}"`));
  }
});

test('legacy profile review action keeps email immutable and uses only the scoped mutation', () => {
  const action = read('app/(dashboard)/account/actions.ts');
  const review = action.slice(action.indexOf('if (legacyReviewRequired)'), action.indexOf('const accountResult = await updateAccount'));
  assert.match(review, /normalizeEmail\(submittedEmail\) !== normalizeEmail\(user\.email\)/);
  assert.match(review, /updateMemberProfile\(member\.profile\.id, profileInput, \{ legacyProfileReview: true \}\)/);
  assert.doesNotMatch(review, /updateAccount\(/);
});

test('legacy password migration checks policy and breach status before compare-and-swap upgrade', () => {
  const login = read('app/(login)/actions.ts');
  const branch = login.slice(login.indexOf('if (passwordHashNeedsUpgrade'), login.indexOf('const role ='));
  assert.match(branch, /passwordSchema\.safeParse\(password\)/);
  assert.match(branch, /checkPasswordBreached\(password\)/);
  assert.match(branch, /eq\(users\.passwordHash, foundUser\.passwordHash\)/);
  assert.match(branch, /if \(!upgraded\)/);
  assert.doesNotMatch(branch, /console\.|logError|passwordDigest|suffix/);
});
