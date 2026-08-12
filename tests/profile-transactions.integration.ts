import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createCompleteGraph, closeHarness, judgeRole, persistedGraph, profileInput, resetIdoc, sql, stewardRole, veterinarianRole } from './postgres-harness.ts';
import { type ProfileTransactionStage, withTestMembershipBoundary } from '../lib/membership/test-boundary.ts';
import { updateMemberProfile } from '../lib/membership/data-access.ts';

beforeEach(resetIdoc);
after(closeHarness);

const classifications = {
  judge: [judgeRole],
  judge_steward: [judgeRole, stewardRole],
  steward: [stewardRole],
  veterinarian: [veterinarianRole],
};

test('every approved classification transition preserves history and unchanged active role rows', async () => {
  for (const [from, fromRoles] of Object.entries(classifications)) {
    for (const [to, toRoles] of Object.entries(classifications)) {
      if (from === to) continue;
      await resetIdoc();
      const graph = await createCompleteGraph();
      await sql`delete from idoc.professional_roles where profile_id=${graph.profile.id}`;
      for (const role of fromRoles) {
        const input = profileInput([role]);
        const value = input.roles[0];
        await sql`insert into idoc.professional_roles(profile_id,role_type,national_federation_country_code,idoc_region,fei_id,official_status,is_technical_delegate)
          values(${graph.profile.id},${value.roleType},${'nationalFederationCountryCode' in value ? value.nationalFederationCountryCode : null},${'idocRegion' in value ? value.idocRegion : null},${'feiId' in value ? value.feiId : null},${'officialStatus' in value ? value.officialStatus : null},${'isTechnicalDelegate' in value ? value.isTechnicalDelegate : null})`;
      }
      const before = await persistedGraph(graph.user.id);
      await withTestMembershipBoundary({ actor: { id: graph.user.id, roles: [] } }, () => updateMemberProfile(graph.profile.id, profileInput(toRoles)));
      const after = await persistedGraph(graph.user.id);
      const active = after.roles.filter(({ effective_to }) => effective_to === null);
      assert.deepEqual(active.map(({ role_type }) => role_type).sort(), toRoles.map(({ roleType }) => roleType).sort(), `${from} -> ${to}`);
      for (const common of fromRoles.filter((role) => toRoles.some(({ roleType }) => roleType === role.roleType))) {
        assert.equal(active.filter(({ role_type }) => role_type === common.roleType).length, 1);
      }
      assert.deepEqual(after.membership, before.membership);
      assert.deepEqual(after.billing, before.billing);
      assert.deepEqual(after.migration, before.migration);
      assert.equal(after.profileHistory.length, before.profileHistory.length + 1);
      assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(after.notifications.length, before.notifications.length + 1);
    }
  }
});

test('successful profile edit commits profile, role history, evidence, and notification atomically', async () => {
  const graph = await createCompleteGraph();
  const before = await persistedGraph(graph.user.id);
  await withTestMembershipBoundary({ actor: { id: graph.user.id, roles: [] } }, () => updateMemberProfile(graph.profile.id, { ...profileInput([stewardRole]), firstName: 'Changed' }));
  const after = await persistedGraph(graph.user.id);
  assert.equal(after.profile.first_name, 'Changed');
  assert.equal(after.roles.filter(({ effective_to }) => effective_to !== null).length, 1);
  assert.equal(after.roles.filter(({ effective_to }) => effective_to === null)[0].role_type, 'steward');
  assert.deepEqual(after.membership, before.membership);
  assert.deepEqual(after.billing, before.billing);
  assert.deepEqual(after.migration, before.migration);
  assert.equal(after.profileHistory.length, 1);
  assert.equal(after.audit.length, 1);
  assert.equal(after.notifications.length, 1);
});

test('controlled failures at every profile-edit stage roll back the complete persisted graph', async () => {
  const stages: ProfileTransactionStage[] = ['profile-write', 'role-closure', 'role-insertion', 'profile-history-insertion', 'audit-insertion', 'notification-insertion'];
  for (const stage of stages) {
    await resetIdoc();
    const graph = await createCompleteGraph();
    const before = await persistedGraph(graph.user.id);
    await assert.rejects(withTestMembershipBoundary({ actor: { id: graph.user.id, roles: [] }, failAt: stage }, () => updateMemberProfile(graph.profile.id, profileInput([stewardRole]))));
    assert.deepEqual(await persistedGraph(graph.user.id), before, stage);
  }
});

test('audit and profile-change evidence remains immutable and excludes sensitive descriptive values', async () => {
  const graph = await createCompleteGraph();
  await withTestMembershipBoundary({ actor: { id: graph.user.id, roles: [] } }, () => updateMemberProfile(graph.profile.id, profileInput([stewardRole])));
  await assert.rejects(sql`update idoc.audit_log set action='tampered'`);
  await assert.rejects(sql`delete from idoc.audit_log`);
  await assert.rejects(sql`update idoc.profile_change_history set before_json='{}'`);
  await assert.rejects(sql`delete from idoc.profile_change_history`);
  const persisted = await persistedGraph(graph.user.id);
  const evidence = JSON.stringify({ audit: persisted.audit, profileHistory: persisted.profileHistory });
  for (const forbidden of ['fixture-password-hash', '@example.test', 'stripe_secret', 'raw token', 'DATABASE_URL']) {
    assert.equal(evidence.includes(forbidden), false, forbidden);
  }
});
