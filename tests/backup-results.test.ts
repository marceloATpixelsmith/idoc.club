import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { backupInProgress, drillIsFullPass, parseBackupManifest, parseBackupSelection, parseDrillResult } from '../lib/admin/backup-results.ts';

const object = 'idoc/ayni_space/daily/20261016T071700Z-38916434347-1/idoc-both-schemas.dump.gpg';
const manifest = { version: 1, object, startedAtUtc: '20261016T071700Z', kind: 'daily', sha256: 'a'.repeat(64), sizeBytes: 1234, tableCount: 2, counts: { 'idoc_production.members': 10, 'idoc_staging.members': 3 } };
const result = { version: 1, status: 'PASS', object, backupStartedAtUtc: '20261016T071700Z', checkedAtUtc: '2026-10-16T08:00:00Z', checksumMatched: true, manifestTables: 2, schemasRestored: ['idoc_staging=1'], rowCountMismatches: [] };

test('a well-formed backup manifest parses and totals rows', () => {
  const parsed = parseBackupManifest(JSON.stringify(manifest));
  assert.equal(parsed?.totalRows, 13);
  assert.equal(parsed?.kind, 'daily');
});

test('the slim annotation form (totalRows, no counts) parses, and stays far below the 4096-character annotation limit', () => {
  const { counts: _counts, ...slim } = manifest;
  const text = JSON.stringify({ ...slim, totalRows: 123456 });
  assert.ok(text.length < 600);
  assert.equal(parseBackupManifest(text)?.totalRows, 123456);
  assert.equal(parseBackupManifest(JSON.stringify(slim)), null); // neither counts nor totalRows
});

test('malformed or hostile manifests are rejected', () => {
  assert.equal(parseBackupManifest('not json'), null);
  assert.equal(parseBackupManifest(JSON.stringify({ ...manifest, object: '../../etc/passwd' })), null);
  assert.equal(parseBackupManifest(JSON.stringify({ ...manifest, sha256: 'xyz' })), null);
  assert.equal(parseBackupManifest(JSON.stringify({ ...manifest, counts: { a: -1 } })), null);
  assert.equal(parseBackupManifest(JSON.stringify({ ...manifest, version: 2 })), null);
});

test('a drill is a full pass only when status, checksum and every row count agree', () => {
  assert.equal(drillIsFullPass(parseDrillResult(JSON.stringify(result))!), true);
  assert.equal(drillIsFullPass(parseDrillResult(JSON.stringify({ ...result, checksumMatched: null }))!), false);
  assert.equal(drillIsFullPass(parseDrillResult(JSON.stringify({ ...result, checksumMatched: false }))!), false);
  assert.equal(drillIsFullPass(parseDrillResult(JSON.stringify({ ...result, manifestTables: 0 }))!), false);
  const failed = parseDrillResult(JSON.stringify({ ...result, status: 'FAIL', rowCountMismatches: [{ table: 'idoc_staging.a', expected: 6, actual: 5 }] }))!;
  assert.equal(drillIsFullPass(failed), false);
  assert.deepEqual(failed.rowCountMismatches, [{ table: 'idoc_staging.a', expected: 6, actual: 5 }]);
  // PASS with a mismatch listed is still not a pass.
  assert.equal(drillIsFullPass(parseDrillResult(JSON.stringify({ ...result, rowCountMismatches: [{ table: 't', expected: 1, actual: 2 }] }))!), false);
});

test('only "latest" or a well-formed object key can be selected', () => {
  assert.equal(parseBackupSelection('latest'), 'latest');
  assert.equal(parseBackupSelection(object), object);
  for (const bad of ['', 'idoc/ayni_space/daily/x/idoc-both-schemas.dump.gpg', '../x', null, undefined, 5]) assert.equal(parseBackupSelection(bad), null);
});

test('the Backups page is Super Admin only, CSRF-checked, step-up protected and audited; the web app never touches R2', () => {
  const page = readFileSync('app/(dashboard)/admin/operations/backups/page.tsx', 'utf8');
  assert.equal((page.match(/requireSuperAdmin\(actor\)/g) ?? []).length, 2); // the page and the shared action authorizer
  assert.match(page, /requireCsrfToken\(formData/);
  assert.equal((page.match(/requireFreshStepUp\(actor, 'change-security-settings'/g) ?? []).length, 3); // maintenance, drill, backup
  assert.match(page, /recordDrillRequest\(actor\.id, selection\)[\s\S]*dispatchRestoreDrill\(selection\)/); // audited before dispatch
  assert.match(page, /reserveBackupRequest\(actor\.id\)[\s\S]*dispatchBackup\(\)/); // on-demand backup: audited before dispatch
  assert.match(page, /backupInProgress\(await listBackupRuns\(3\)\)[\s\S]*reserveBackupRequest/); // refused while one is queued or running
  const tool = readFileSync('lib/admin/backup-tool.ts', 'utf8');
  assert.doesNotMatch(tool, /R2_|AWS_|IDOC_BACKUP|PASSPHRASE|MIGRATION_DATABASE/);
  assert.match(tool, /GITHUB_BACKUP_TOOL_TOKEN/);
  assert.match(tool, /dispatchBackup[\s\S]*BACKUP_WORKFLOW\}\/dispatches[\s\S]*ref: 'main'/); // the backup runs the main-branch workflow, with no caller-chosen inputs
  assert.doesNotMatch(tool, /console\.|logError\(.*token/i);
});

test('a second on-demand backup is refused while one is queued or running', () => {
  assert.equal(backupInProgress([]), false);
  assert.equal(backupInProgress([{ state: 'completed' }, { state: 'failed' }]), false);
  assert.equal(backupInProgress([{ state: 'completed' }, { state: 'queued' }]), true);
  assert.equal(backupInProgress([{ state: 'running' }]), true);
});
