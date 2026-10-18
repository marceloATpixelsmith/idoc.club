import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { after, beforeEach } from 'node:test';
import { archiveMembers, deleteMembers } from '../lib/admin/member-lifecycle.ts';
import { closeHarness, createCompleteGraph, createProfile, createUser, resetIdoc, sql } from './postgres-harness.ts';

beforeEach(resetIdoc);
after(closeHarness);

async function addProfileHistory(profileId: number, actorId: number) {
  await sql`insert into idoc.profile_change_history(profile_id,actor_id,before_json,after_json)
    values(${profileId},${actorId},'{}'::jsonb,'{}'::jsonb)`;
}

async function addAuditEvent(actorId: number, entityId: number, action = 'fixture.member_event') {
  await sql`insert into idoc.audit_log(actor_id,action,entity_type,entity_id,before_json,after_json)
    values(${actorId},${action},'user',${String(entityId)},'{}'::jsonb,'{}'::jsonb)`;
}

async function addSession(userId: number) {
  const now = new Date();
  const expires = new Date(now.getTime() + 60 * 60 * 1000);
  await sql`insert into idoc.auth_sessions(session_id,user_id,session_version,authenticated_at,last_activity_at,absolute_expires_at)
    values(${randomUUID()},${userId},0,${now.toISOString()},${now.toISOString()},${expires.toISOString()})`;
}

test('permanent member deletion purges linked member history and account while preserving immutable audit rows', async () => {
  const { user, profile } = await createCompleteGraph();
  const actor = await createUser();
  await addProfileHistory(profile.id, user.id);
  await addAuditEvent(user.id, user.id);
  await addSession(user.id);

  assert.equal(await deleteMembers([String(user.id)], actor.id), 1);

  assert.equal((await sql`select count(*)::int as count from idoc.users where id=${user.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.profiles where id=${profile.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.memberships where profile_id=${profile.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.profile_change_history where profile_id=${profile.id}`)[0].count, 0);
  assert.equal((await sql`select count(*)::int as count from idoc.auth_sessions where user_id=${user.id}`)[0].count, 0);

  const retained = await sql`select actor_id,action,entity_type,entity_id,before_json,after_json
    from idoc.audit_log where entity_id=${String(user.id)} order by id`;
  assert.equal(retained.length, 2);
  assert.equal(retained[0].actor_id, null);
  assert.equal(retained[0].action, 'fixture.member_event');
  assert.equal(retained[0].entity_id, String(user.id));
  assert.deepEqual(retained[0].before_json, {});
  assert.deepEqual(retained[0].after_json, {});
  assert.equal(retained[1].actor_id, actor.id);
  assert.equal(retained[1].action, 'admin.member.permanently_deleted');
});

test('active subscription blocks archive and permanent delete before any member data changes', async () => {
  const actor = await createUser();
  const member = await createUser();
  const profile = await createProfile(member.id);
  await sql`insert into idoc.subscriptions(profile_id,external_subscription_id,price_id,status,current_period_end)
    values(${profile.id},'sub_active_fixture','price_fixture','active','2099-12-31')`;
  await addSession(member.id);

  await assert.rejects(deleteMembers([String(member.id)], actor.id), /active billing subscriptions/i);
  await assert.rejects(archiveMembers([String(member.id)], actor.id), /active billing subscriptions/i);

  assert.equal((await sql`select account_state from idoc.users where id=${member.id}`)[0].account_state, 'active');
  assert.equal((await sql`select count(*)::int as count from idoc.profiles where id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.subscriptions where profile_id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.auth_sessions where user_id=${member.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.audit_log where entity_id=${String(member.id)}`)[0].count, 0);
});

test('only active administrator grants block member archive and deletion', async () => {
  const actor = await createUser();
  const revokedDeleteTarget = await createUser();
  const revokedArchiveTarget = await createUser();
  await sql`insert into idoc.application_roles(user_id,role,granted_by)
    values(${revokedDeleteTarget.id},'administrator',${actor.id}),
          (${revokedArchiveTarget.id},'super_admin',${actor.id})`;
  await sql`update idoc.application_roles set revoked_at=now()
    where user_id in (${revokedDeleteTarget.id},${revokedArchiveTarget.id})`;

  assert.equal(await deleteMembers([String(revokedDeleteTarget.id)], actor.id), 1);
  assert.equal(await archiveMembers([String(revokedArchiveTarget.id)], actor.id), 1);
  assert.equal((await sql`select account_state from idoc.users where id=${revokedArchiveTarget.id}`)[0].account_state, 'deleted');

  const activeAdmin = await createUser();
  await sql`insert into idoc.application_roles(user_id,role,granted_by)
    values(${activeAdmin.id},'administrator',${actor.id})`;
  await assert.rejects(deleteMembers([String(activeAdmin.id)], actor.id), /Administrator accounts cannot be bulk deleted/);
  await assert.rejects(archiveMembers([String(activeAdmin.id)], actor.id), /Administrator accounts cannot be bulk archived/);
  assert.equal((await sql`select account_state from idoc.users where id=${activeAdmin.id}`)[0].account_state, 'active');
});

test('permanent deletion rolls back its complete purge when an unexpected foreign key blocks the final user delete', async () => {
  const { user, profile } = await createCompleteGraph();
  const actor = await createUser();
  await addProfileHistory(profile.id, user.id);
  await addAuditEvent(user.id, user.id);
  await sql`create table idoc.member_delete_test_blocker (
    user_id integer not null references idoc.users(id)
  )`;
  await sql`insert into idoc.member_delete_test_blocker(user_id) values(${user.id})`;

  await assert.rejects(deleteMembers([String(user.id)], actor.id));

  assert.equal((await sql`select count(*)::int as count from idoc.users where id=${user.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.profiles where id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select count(*)::int as count from idoc.profile_change_history where profile_id=${profile.id}`)[0].count, 1);
  assert.equal((await sql`select actor_id,action from idoc.audit_log where action='fixture.member_event' and entity_id=${String(user.id)}`)[0].actor_id, user.id);
  await assert.rejects(sql`delete from idoc.profile_change_history where profile_id=${profile.id}`);
  await assert.rejects(sql`update idoc.audit_log set actor_id=null where action='fixture.member_event' and entity_id=${String(user.id)}`);
});

test('permanent deletion explains which accounts created content and that archived ones stay archived', async () => {
  const actor = await createUser();
  const author = await createUser();
  const plain = await createUser();
  await sql`update idoc.users set account_state='deleted' where id=${author.id}`;
  const [team] = await sql<{ id: number }[]>`insert into idoc.teams(name) values('Authored fixture') returning id`;
  await sql`insert into idoc.invitations(team_id,email,role,invited_by) values(${team.id},'invitee@example.test','member',${author.id})`;

  await assert.rejects(deleteMembers([String(author.id), String(plain.id)], actor.id), (error: unknown) => {
    const message = (error as Error).message;
    assert.match(message, new RegExp(`${author.email.replace(/[.+]/g, '\\$&')} \\(already archived\\): invitations sent`));
    assert.doesNotMatch(message, new RegExp(plain.email.replace(/[.+]/g, '\\$&')));
    assert.match(message, /already archived, which is the right final state/);
    assert.doesNotMatch(message, /Archive the ones/);
    return true;
  });
  // Nothing was deleted, including the member who had no content.
  assert.equal((await sql`select count(*)::int as n from idoc.users where id in ${sql([author.id, plain.id])}`)[0].n, 2);

  // A not-yet-archived author is told to archive it.
  await sql`update idoc.users set account_state='active' where id=${author.id}`;
  await assert.rejects(deleteMembers([String(author.id)], actor.id), /\(not archived\): invitations sent[\s\S]*Archive the ones that are not archived yet/);
});
