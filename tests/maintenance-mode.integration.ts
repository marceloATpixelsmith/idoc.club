import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { maintenanceModeEnabled, readMaintenanceState, resetMaintenanceModeCacheForTests, setMaintenanceMode, userIsSuperAdmin } from '../lib/admin/maintenance-mode.ts';
import { closeHarness, createUser, grantRole, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(async () => {
  await resetIdoc();
  resetMaintenanceModeCacheForTests();
});
after(closeHarness);

test('maintenance mode defaults off, toggles on and off with an audit row each time, and is read through a short cache', async () => {
  const admin = await createUser();
  await grantRole(admin.id, 'super_admin');
  assert.equal(await maintenanceModeEnabled(0), false);

  await setMaintenanceMode(admin.id, true, '  planned restore  ');
  assert.equal(await maintenanceModeEnabled(10_000), true);
  const on = await readMaintenanceState();
  assert.equal(on.enabled, true);
  assert.equal(on.reason, 'planned restore');
  assert.equal(on.changedByUserId, admin.id);

  // Within the cache window an out-of-band change is not yet visible; after it, it is.
  await sql`update idoc.maintenance_mode set enabled = false`;
  assert.equal(await maintenanceModeEnabled(10_500), true);
  assert.equal(await maintenanceModeEnabled(14_000), false);

  await setMaintenanceMode(admin.id, true, null);
  await setMaintenanceMode(admin.id, false, null);
  const audit = await sql<{ action: string; actor_id: number }[]>`select action, actor_id from idoc.audit_log where entity_type='maintenance_mode' order by id`;
  assert.deepEqual(audit.map((row) => row.action), [
    'admin.maintenance_mode.enabled', 'admin.maintenance_mode.enabled', 'admin.maintenance_mode.disabled']);
  assert.ok(audit.every((row) => row.actor_id === admin.id));
});

test('only an active super_admin grant counts as a Super Admin', async () => {
  const admin = await createUser();
  const member = await createUser();
  await grantRole(admin.id, 'super_admin');
  await grantRole(member.id, 'administrator');
  assert.equal(await userIsSuperAdmin(admin.id), true);
  assert.equal(await userIsSuperAdmin(member.id), false);
  await sql`update idoc.application_roles set revoked_at = now() where user_id = ${admin.id}`;
  assert.equal(await userIsSuperAdmin(admin.id), false);
});
