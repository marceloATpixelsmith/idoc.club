import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/content/pages.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0044_restricted_cms.sql', 'utf8');

test('persisted CMS pages retain audience data needed by the public read-only delivery path', () => {
  for (const value of ['public','member','judge','steward','veterinarian']) assert.match(migration, new RegExp(value));
  assert.match(migration, /content_page_revisions/);
});

test('public reads enforce published and due state plus entitlement-role audiences in SQL', () => {
  assert.match(source, /p\.status='published'/);
  assert.match(source, /p\.publish_at is null or p\.publish_at<=now\(\)/);
  assert.match(source, /latest\.valid_until>=current_date/);
  assert.match(source, /r\.effective_to is null/);
});

test('Pages administration is retired while existing public CMS delivery remains', () => {
  assert.match(source, /export async function getVisibleContentPage/);
  assert.doesNotMatch(source, /listAdminContentPages|getAdminContentPage|saveContentPage|archiveContentPage|deleteContentPage/);
});
