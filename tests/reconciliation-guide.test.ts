import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { FINDING_GUIDE, guideForKind, summarizeFindings } from '../lib/payments/reconciliation-guide.ts';

test('every finding kind the database allows has a plain-language guide with steps', () => {
  const schema = readFileSync(new URL('../lib/db/schema.ts', import.meta.url), 'utf8');
  const line = schema.split('\n').find((candidate) => candidate.includes('reconciliation_findings_kind_check')) ?? '';
  const clause = line.slice(line.indexOf(' in ('));
  const kinds = [...clause.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.ok(kinds.length >= 10, 'could not read the allowed kinds from the schema');
  for (const kind of kinds) {
    const guide = guideForKind(kind);
    assert.ok(guide, `missing guide for ${kind}`);
    assert.ok(guide.plain.length > 20 && guide.why.length > 0 && guide.investigate.length > 0 && guide.resolve.length > 0, `incomplete guide for ${kind}`);
  }
  assert.equal(new Set(FINDING_GUIDE.map((entry) => entry.kind)).size, FINDING_GUIDE.length);
});

test('the summary counts each type and lists the ones needing action first', () => {
  const rows = summarizeFindings([
    { kind: 'unlinked_customer' }, { kind: 'unlinked_customer' }, { kind: 'unlinked_customer' },
    { kind: 'orphaned_subscription' }, { kind: 'dispute' }, { kind: 'dispute' }, { kind: 'something_new' },
  ]);
  assert.deepEqual(rows.map((row) => [row.kind, row.count, row.severity]), [
    ['dispute', 2, 'act'], ['orphaned_subscription', 1, 'act'], ['unlinked_customer', 3, 'check'], ['something_new', 1, 'check'],
  ]);
  assert.match(rows[3].plain, /no explanation yet/);
  assert.deepEqual(summarizeFindings([]), []);
});
