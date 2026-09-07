import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('lib/support/inbox.ts', 'utf8');
const migration = readFileSync('lib/db/migrations/0039_support_inbox.sql', 'utf8');
const memberThread = readFileSync('app/(dashboard)/dashboard/support/[publicId]/page.tsx', 'utf8');

test('support categories, states, body lengths, and opaque identifiers are constrained in both layers', () => {
  for (const value of ['billing_membership', 'seminars', 'technical_support', 'admin_responded', 'member_replied', 'closed']) {
    assert.match(source, new RegExp(value)); assert.match(migration, new RegExp(value));
  }
  assert.match(migration, /char_length\("body"\) between 1 and 10000/);
  assert.match(migration, /char_length\("subject"\) between 1 and 160/);
  assert.match(migration, /"public_id" uuid DEFAULT gen_random_uuid/);
  assert.match(migration, /support_messages_immutable.*BEFORE UPDATE OR DELETE/);
});

test('member boundaries derive ownership and never accept a submitted member identity', () => {
  assert.match(source, /member_user_id=\$\{actor\.id\}/);
  assert.doesNotMatch(source, /input\.member|memberUserId:/);
  assert.match(source, /requireAccountAccess\('member'\)/);
  assert.match(source, /isAdministrator\(actor\)/);
});

test('administrator mutations authorize roles and revalidate submitted assignees', () => {
  assert.match(source, /requireAccountAccess\('administration'\)/);
  assert.match(source, /requireAdministrator\(actor\)/);
  assert.match(source, /resolveEligibleAdministrator\(administratorValue\)/);
  assert.match(source, /u\.account_state='active'/);
  assert.match(source, /requireSuperAdmin\(actor\)/);
});

test('thread transitions, read sides, chronological order, and idempotency are explicit', () => {
  assert.match(source, /status='admin_responded'/);
  assert.match(source, /status='member_replied'/);
  assert.match(source, /status === 'closed'/);
  assert.match(source, /author_side === 'admin' \? 'admin_responded'/);
  assert.match(source, /member_read_at=now\(\)/);
  assert.match(source, /admin_read_at=now\(\)/);
  assert.match(source, /order by m\.created_at,m\.id/);
  assert.match(source, /on conflict \(author_user_id,idempotency_key\) do nothing/);
});

test('message presentation uses escaped React text with whitespace preservation', () => {
  assert.match(memberThread, /whitespace-pre-wrap/);
  assert.match(memberThread, /String\(message\.body\)/);
  assert.doesNotMatch(memberThread, /dangerouslySetInnerHTML/);
});

test('assignment and workflow audit events exclude support bodies', () => {
  assert.match(source, /support\.assignment\.changed/);
  assert.match(source, /support\.conversation\.closed/);
  const auditStatements = source.match(/insert into idoc\.audit_log[^;]+/gs) ?? [];
  assert.ok(auditStatements.length >= 2);
  for (const statement of auditStatements) assert.doesNotMatch(statement, /\$\{body\}/);
});
