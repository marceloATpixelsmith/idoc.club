import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { getTablePreferences, resetTablePreferences, saveTablePreferences } from '../lib/admin/table-preferences.ts';
import { adminUser, asAdmin, closeHarness, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

test('preferences upsert independently by authenticated administrator and table', async () => {
  const first = await adminUser();
  const second = await adminUser();
  await asAdmin(first.id, () => saveTablePreferences('memberships', { pageSize: 50, q: 'Ada', status: 'expired' }));
  await asAdmin(first.id, () => saveTablePreferences('support', { q: 'invoice', status: 'open' }));
  await asAdmin(second.id, () => saveTablePreferences('memberships', { pageSize: 10, status: 'active' }));
  assert.deepEqual(await asAdmin(first.id, () => getTablePreferences('memberships')), { pageSize: 50, q: 'Ada', status: 'expired' });
  assert.deepEqual(await asAdmin(first.id, () => getTablePreferences('support')), { q: 'invoice', status: 'open' });
  assert.deepEqual(await asAdmin(second.id, () => getTablePreferences('memberships')), { pageSize: 10, status: 'active' });
  assert.equal((await sql`select * from idoc.administrator_table_preferences`).length, 3);
});

test('invalid saved JSON is ignored and reset affects only the authenticated owner and table', async () => {
  const first = await adminUser();
  const second = await adminUser();
  await sql`insert into idoc.administrator_table_preferences(user_id,table_identifier,preferences) values(${first.id},'memberships',${sql.json({ status: 'forged', executable: 'alert(1)' })})`;
  await asAdmin(second.id, () => saveTablePreferences('memberships', { status: 'expired' }));
  assert.equal(await asAdmin(first.id, () => getTablePreferences('memberships')), null);
  await asAdmin(first.id, () => resetTablePreferences('memberships'));
  assert.deepEqual(await asAdmin(second.id, () => getTablePreferences('memberships')), { status: 'expired' });
});
