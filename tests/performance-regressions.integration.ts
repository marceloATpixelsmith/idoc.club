import assert from 'node:assert/strict';
import test, { after, afterEach, beforeEach } from 'node:test';
import { loadAccountFacts, loadSessionGate } from '../lib/membership/session-gate-loader.ts';
import { listAdminMembers, type MemberFilters } from '../lib/membership/admin-memberships.ts';
import { getRevenueReport, resetRevenueReportCacheForTests } from '../lib/payments/revenue-report.ts';
import { dispatchBackup, listBackupRuns, listBackups, resetBackupToolCachesForTests } from '../lib/admin/backup-tool.ts';
import {
  adminUser, asAdmin, closeHarness, createMembership, createProfile, createUser, grantRole, judgeRole, resetIdoc, sql, stewardRole, veterinarianRole,
} from './postgres-harness.ts';

// Contracts for the performance changes: the single-statement account facts that middleware, authenticatedActor and the header share,
// the roster's lean count query, the opt-in revenue cache and the Backups page's GitHub caches.
beforeEach(resetIdoc);
afterEach(() => { resetRevenueReportCacheForTests(); resetBackupToolCachesForTests(); });
after(closeHarness);

test('account facts return state, active roles and the newest membership in one read, and null for an unknown user', async () => {
  const user = await createUser();
  const profile = await createProfile(user.id);
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,source) values(${profile.id},'expired','2023-01-01','2023-12-31','migration')`;
  await sql`insert into idoc.memberships(profile_id,status,starts_on,valid_until,grace_ends_on,source) values(${profile.id},'grace','2024-01-01','2099-12-31','2100-01-15','migration')`;
  await grantRole(user.id, 'administrator');
  await sql`insert into idoc.application_roles(user_id,role,granted_by,revoked_at) values(${user.id},'super_admin',${user.id},now())`;

  const facts = await loadAccountFacts(user.id);
  assert.equal(facts?.accountState, 'active');
  assert.deepEqual(facts?.roles, ['administrator'], 'a revoked grant must not appear');
  assert.deepEqual(facts?.latestMembership, { graceEndsOn: '2100-01-15', status: 'grace', validUntil: '2099-12-31' });
  assert.equal(await loadAccountFacts(2_000_000_000), null);
});

test('account facts and the session gate treat a user with no profile or membership as having none', async () => {
  const user = await createUser();
  const facts = await loadAccountFacts(user.id);
  assert.equal(facts?.latestMembership, null);
  assert.deepEqual(facts?.roles, []);
  assert.deepEqual(await loadSessionGate(user.id, '2026-10-20'), { accountState: 'active', gate: 'payment_only' });
  assert.deepEqual(await loadSessionGate(2_000_000_000, '2026-10-20'), { accountState: 'unknown', gate: 'open' });

  const admin = await createUser();
  await grantRole(admin.id, 'administrator');
  assert.equal((await loadSessionGate(admin.id, '2026-10-20')).gate, 'open', 'an administrator is never gated');

  const member = await createUser();
  await createMembership((await createProfile(member.id)).id);
  assert.equal((await loadSessionGate(member.id, '2026-10-20')).gate, 'open');
});

test('the roster count query joins only what its filters read and still agrees with the listed rows for every filter and sort', async () => {
  const admin = await adminUser();
  const adminProfile = await createProfile(admin.id, [stewardRole]);
  await createMembership(adminProfile.id);
  const made: number[] = [];
  const specs: Array<{ roles: Parameters<typeof createProfile>[1]; current: boolean | null; board?: boolean }> = [
    { roles: [judgeRole], current: true }, { roles: [stewardRole], current: true }, { roles: [judgeRole, stewardRole], current: false },
    { roles: [veterinarianRole], current: true, board: true }, { roles: [judgeRole], current: null },
  ];
  for (const spec of specs) {
    const user = await createUser();
    const profile = await createProfile(user.id, spec.roles);
    if (spec.current !== null) await createMembership(profile.id, spec.current);
    if (spec.board) await sql`update idoc.profiles set is_board_member=true where id=${profile.id}`;
    await sql`insert into idoc.payments(profile_id,source,amount_cents,currency,paid_at,administrator_id,reason) values(${profile.id},'cash',8000,'EUR',now(),${admin.id},'fixture')`;
    made.push(profile.id);
  }
  const filtersToTry: MemberFilters[] = [
    {}, { status: 'active' }, { status: 'expired' }, { status: 'without_active' }, { status: 'administrator' }, { status: 'board_member' }, { status: 'onboarding' },
    { type: 'judge' }, { type: 'combo' }, { type: 'veterinarian' }, { federation: 'DE' }, { region: 'Western Europe & Africa' }, { filters: JSON.stringify([{ id: 'country', operator: 'eq', value: 'DE' }]) },
    { officialStatus: 'steward:FEI Dressage Steward Level 1' }, { expiresFrom: '2099-01-01', expiresTo: '2099-12-31' }, { q: 'Test' }, { q: 'no-such-person' },
    { status: 'active', type: 'judge', federation: 'DE', q: 'Member' }, { sort: 'lastPayment' }, { sort: 'updated', direction: 'desc' }, { sort: 'expires' },
    { filters: JSON.stringify([{ id: 'status', operator: 'eq', value: 'active' }, { id: 'type', operator: 'eq', value: 'judge' }]) },
  ];
  for (const filters of filtersToTry) {
    const listing = await asAdmin(admin.id, () => listAdminMembers({ ...filters, pageSize: 100 }));
    assert.equal(listing.total, listing.rows.length, `total must equal the listed rows for ${JSON.stringify(filters)}`);
  }
  const all = await asAdmin(admin.id, () => listAdminMembers({ pageSize: 100 }));
  assert.equal(all.total, made.length + 1, 'every profile appears exactly once: lean joins must not multiply or drop rows');
});

test('the opt-in revenue cache serves a recent report, never skips authorization, and leaves the live report untouched', async () => {
  const admin = await adminUser();
  const profile = await createProfile((await createUser()).id);
  const record = (cents: number) => sql`insert into idoc.payments(profile_id,source,amount_cents,currency,paid_at,administrator_id,reason)
    values(${profile.id},'cash',${cents},'EUR','2026-09-15T12:00:00Z',${admin.id},'fixture')`;
  await record(8000);
  const first = await asAdmin(admin.id, () => getRevenueReport({}, { cacheSeconds: 60 }));
  assert.equal(first.summary[0]?.totalCents, 8000);
  await record(2000);
  const cached = await asAdmin(admin.id, () => getRevenueReport({}, { cacheSeconds: 60 }));
  assert.equal(cached.summary[0]?.totalCents, 8000, 'served from the per-instance cache');
  const live = await asAdmin(admin.id, () => getRevenueReport({}));
  assert.equal(live.summary[0]?.totalCents, 10000, 'the uncached call always reads the database');
  resetRevenueReportCacheForTests();
  assert.equal((await asAdmin(admin.id, () => getRevenueReport({}, { cacheSeconds: 60 }))).summary[0]?.totalCents, 10000);

  const nobody = await createUser();
  await assert.rejects(asAdmin(nobody.id, () => getRevenueReport({}, { cacheSeconds: 60 })), 'a non-administrator is refused even when a cached report exists');
});

test('the Backups page reads GitHub once per run list and annotation, and a dispatch drops the cached run list', async () => {
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  const object = 'idoc/ayni_space/daily/20261016T071700Z-38916434347-1/idoc-both-schemas.dump.gpg';
  const manifest = JSON.stringify({ version: 1, object, startedAtUtc: '20261016T071700Z', kind: 'daily', sha256: 'a'.repeat(64), sizeBytes: 1234, tableCount: 2, totalRows: 13 });
  const run = { id: 77, status: 'completed', conclusion: 'success', created_at: '2026-10-16T07:17:00Z', updated_at: '2026-10-16T07:20:00Z', html_url: 'https://github.com/x/y/actions/runs/77', run_number: 5 };
  const respond = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url.replace('https://api.github.com/repos/marceloATpixelsmith/idoc.club', '')}`);
    if (url.includes('/dispatches')) return respond(null, 204);
    if (url.includes('/runs?')) return respond({ workflow_runs: [run] });
    if (url.endsWith('/jobs?per_page=5')) return respond({ jobs: [{ id: 900 }] });
    if (url.includes('/annotations')) return respond([{ title: 'idoc-backup-manifest', message: manifest }]);
    throw new Error(`unexpected GitHub request ${url}`);
  }) as typeof fetch;
  const previousToken = process.env.GITHUB_BACKUP_TOOL_TOKEN;
  process.env.GITHUB_BACKUP_TOOL_TOKEN = 'test-token';
  try {
    assert.equal((await listBackups()).length, 1);
    assert.equal((await listBackups()).length, 1);
    assert.equal(calls.filter((call) => call.includes('/runs?')).length, 1, 'the run list is read once within the cache window');
    assert.equal(calls.filter((call) => call.includes('/annotations')).length, 1, 'a completed run\'s annotation is read once');

    await listBackupRuns();
    await listBackupRuns();
    assert.equal(calls.filter((call) => call.includes('/runs?') && !call.includes('status=success')).length, 1);
    await dispatchBackup();
    await listBackupRuns();
    assert.equal(calls.filter((call) => call.includes('/runs?') && !call.includes('status=success')).length, 2, 'a dispatch drops cached run lists so a new run shows at once');
    assert.equal(calls.filter((call) => call.includes('/annotations')).length, 1, 'annotations of completed runs stay cached');
  } finally {
    globalThis.fetch = realFetch;
    if (previousToken === undefined) delete process.env.GITHUB_BACKUP_TOOL_TOKEN; else process.env.GITHUB_BACKUP_TOOL_TOKEN = previousToken;
  }
});
