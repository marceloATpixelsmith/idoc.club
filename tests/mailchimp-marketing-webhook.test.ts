import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMailchimpWebhook, verifyMailchimpWebhookKey } from '../lib/notifications/mailchimp-marketing-webhook.ts';

const form = (fields: Record<string, string>) => new URLSearchParams(fields);

test('the webhook key must match exactly and is never accepted when missing', () => {
  assert.equal(verifyMailchimpWebhookKey('secret-value', 'secret-value'), true);
  assert.equal(verifyMailchimpWebhookKey('secret-valuX', 'secret-value'), false);
  assert.equal(verifyMailchimpWebhookKey('short', 'secret-value'), false);
  assert.equal(verifyMailchimpWebhookKey(null, 'secret-value'), false);
  assert.equal(verifyMailchimpWebhookKey('anything', undefined), false);
  assert.equal(verifyMailchimpWebhookKey('', ''), false);
});

test('unsubscribe, cleaned and subscribe deliveries are parsed from Mailchimp form fields', () => {
  for (const type of ['unsubscribe', 'cleaned', 'subscribe'] as const) {
    assert.deepEqual(
      parseMailchimpWebhook(form({ type, fired_at: '2026-10-20 14:32:37', 'data[email]': ' Member@Example.Test ', 'data[list_id]': 'audience' })),
      { email: 'member@example.test', listId: 'audience', type },
    );
  }
});

test('other event types and incomplete deliveries are ignored', () => {
  assert.equal(parseMailchimpWebhook(form({ type: 'profile', 'data[email]': 'member@example.test', 'data[list_id]': 'audience' })), null);
  assert.equal(parseMailchimpWebhook(form({ type: 'upemail', 'data[new_email]': 'new@example.test', 'data[old_email]': 'old@example.test', 'data[list_id]': 'audience' })), null);
  assert.equal(parseMailchimpWebhook(form({ type: 'unsubscribe', 'data[list_id]': 'audience' })), null);
  assert.equal(parseMailchimpWebhook(form({ type: 'unsubscribe', 'data[email]': 'member@example.test' })), null);
  assert.equal(parseMailchimpWebhook(form({})), null);
});

// docs/19: the "keep me updated" flag describes only the Mailchimp marketing audience. Every system
// email (account, security, billing, renewal, seminar) must go out regardless of it, so no code that
// decides whether or to whom a message is sent may read it.
test('no system-email code path reads the marketing opt-in flag', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const root = new URL('..', import.meta.url).pathname;
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(join(root, directory))) {
      const relative = join(directory, name);
      if (statSync(join(root, relative)).isDirectory()) walk(relative);
      else if (/\.(ts|tsx)$/.test(name)) files.push(relative);
    }
  };
  for (const directory of ['lib', 'app']) walk(directory);
  const allowed = new Set([
    'lib/db/schema.ts',
    'lib/membership/data-access.ts',
    'lib/membership/marketing-preference.ts',
    'app/(dashboard)/admin/members/admin-profile-form.tsx',
    'app/(dashboard)/dashboard/profile/profile-form.tsx',
  ]);
  const readers = files.filter((file) => /keepUpdatedOptIn|keep_updated_opt_in/.test(readFileSync(join(root, file), 'utf8')) && !allowed.has(file));
  assert.deepEqual(readers, []);
  for (const file of files.filter((candidate) => /^lib\/(notifications|payments)\//.test(candidate))) {
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /marketing-preference|onboardingConsents|onboarding_consents/, `${file} must not depend on the marketing preference`);
  }
});
