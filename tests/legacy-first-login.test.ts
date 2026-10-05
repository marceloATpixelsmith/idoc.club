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
  assert.match(data, /legacyProfileReviewRequired && !isPrivilegedActor\(actor\)[\s\S]*\['account', 'onboarding', 'profile_review'\]/);
  assert.match(data, /legacyProfileReviewRequired: false, legacyProfileReviewedAt: now/);
  assert.match(data, /resetLegacyProfileReview[\s\S]*requireAdministrator/);
  assert.match(page, /legacyProfileReviewRequired[\s\S]*dashboard\/profile\?confirmDetails=1/);
  for (const field of ['nationalFederationCountryCode', 'idocRegion', 'feiId', 'judgeStatus', 'stewardStatus', 'isTechnicalDelegate']) {
    assert.match(form, new RegExp(`name=["'{].*${field}|name="${field}"`));
  }
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
