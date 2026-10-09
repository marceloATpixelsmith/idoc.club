import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { newsVisibilityBroadens, parsePromotionDataset } from '../lib/admin/data-promotion';

test('data promotion dataset allowlist rejects member, billing, registration, auth, and operational data', () => {
  assert.equal(parsePromotionDataset('news'), 'news');
  assert.equal(parsePromotionDataset('seminar'), 'seminar');
  assert.equal(parsePromotionDataset('organization'), 'organization');

  for (const forbidden of [
    'members',
    'profiles',
    'memberships',
    'payments',
    'subscriptions',
    'seminar_registrations',
    'auth_sessions',
    'mfa_factors',
    'trusted_devices',
    'audit_log',
    'notification_outbox',
    'administrator_table_preferences',
  ]) assert.equal(parsePromotionDataset(forbidden), null);
});

test('article audience promotion never broadens an existing Production audience', () => {
  assert.equal(newsVisibilityBroadens(['public'], ['members']), true);
  assert.equal(newsVisibilityBroadens(['members'], ['judge']), true);
  assert.equal(newsVisibilityBroadens(['judge', 'steward'], ['judge']), true);
  assert.equal(newsVisibilityBroadens(['judge'], ['judge', 'steward']), false);
  assert.equal(newsVisibilityBroadens(['judge'], ['members']), false);
  assert.equal(newsVisibilityBroadens(['members'], ['public']), false);
  assert.equal(newsVisibilityBroadens(['public'], ['public']), false);
});

test('runtime writes are limited to approved Production tables and secret-safe audit evidence', async () => {
  const source = await readFile(new URL('../lib/admin/data-promotion.ts', import.meta.url), 'utf8');
  const writeMatches = [...source.matchAll(/(?:insert\s+into|update|delete\s+from)\s+idoc_production\.([a-z_]+)/gi)]
    .map((match) => match[1]);
  assert.ok(writeMatches.length > 0);
  assert.deepEqual(new Set(writeMatches), new Set(['news_articles', 'seminars', 'organization_settings', 'audit_log']));
  assert.doesNotMatch(source, /idoc_production\.(?:memberships|payments|subscriptions|seminar_registrations)\s+set/i);
  assert.match(source, /EXPECTED_ROLE = 'idoc_data_promoter'/);
  assert.match(source, /DATA_PROMOTION_DATABASE_URL/);
  assert.match(source, /DATA_PROMOTION_PLAN_SECRET/);
  assert.doesNotMatch(source, /process\.env\.POSTGRES_URL/);
});

test('promotion migration gives News and Seminars independent UUID identities', async () => {
  const migration = await readFile(new URL('../lib/db/migrations/0071_permanent_data_promotion.sql', import.meta.url), 'utf8');
  assert.match(migration, /news_articles[\s\S]*promotion_key[\s\S]*gen_random_uuid/);
  assert.match(migration, /seminars[\s\S]*promotion_key[\s\S]*gen_random_uuid/);
  assert.match(migration, /news_articles_promotion_key_unique/);
  assert.match(migration, /seminars_promotion_key_unique/);
});
