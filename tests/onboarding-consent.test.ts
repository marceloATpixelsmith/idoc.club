import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { onboardingConsentSchema } from '../lib/membership/validation.ts';

test('onboarding requires Terms and Privacy acceptance while marketing remains optional', () => {
  assert.equal(onboardingConsentSchema.safeParse({ keepUpdated: true, privacyAccepted: true, termsAccepted: true }).success, true);
  assert.equal(onboardingConsentSchema.safeParse({ keepUpdated: false, privacyAccepted: true, termsAccepted: true }).success, true);
  assert.equal(onboardingConsentSchema.safeParse({ keepUpdated: true, privacyAccepted: false, termsAccepted: true }).success, false);
  assert.equal(onboardingConsentSchema.safeParse({ keepUpdated: true, privacyAccepted: true, termsAccepted: false }).success, false);
});

test('consent migration does not fabricate consent for existing profiles', () => {
  const migration = readFileSync(new URL('../lib/db/migrations/0019_onboarding_consents.sql', import.meta.url), 'utf8');
  assert.match(migration, /CREATE TABLE "idoc"\."onboarding_consents"/);
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE "idoc"\."profiles"/i);
  assert.match(migration, /"terms_accepted_at" timestamp with time zone NOT NULL/);
  assert.match(migration, /"privacy_accepted_at" timestamp with time zone NOT NULL/);
  assert.match(migration, /"keep_updated_opt_in" boolean DEFAULT false NOT NULL/);
});

test('marketing subscription is bounded and updates existing audience members', () => {
  const marketing = readFileSync(new URL('../lib/notifications/mailchimp-marketing.ts', import.meta.url), 'utf8');
  assert.match(marketing, /status: 'subscribed'/);
  assert.match(marketing, /AbortSignal\.timeout\(5000\)/);
  assert.match(marketing, /mailchimp_marketing_subscribe_failed/);
});
