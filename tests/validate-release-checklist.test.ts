import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractRunbookItems, validateChecklist } from '../scripts/validate-release-checklist.mjs';

// AUTH-OPERATIONS-011: proves the real production validator functions -- not a description of what
// they should do -- actually catch each drift/integrity class they claim to: an item added to one
// side and not the other, reworded text, a "verified" item with no real evidence, and an "unchecked"
// item that already carries evidence. Also proves the current repository state (docs/07 and
// docs/25-release-readiness-checklist.json as they actually exist right now) passes cleanly.

const heading = '## 15.6 Release signoff (leave unchecked until manually proved)';
function runbook(items: string[]) {
  return `# doc\n\n${heading}\n\n${items.map((item) => `- [ ] ${item}: __________`).join('\n')}\n\n## 16. Next section\n`;
}
function checklist(items: { description: string; evidence?: string | null; id?: string; status?: string }[]) {
  return JSON.stringify({ items: items.map((item, index) => ({
    description: item.description, evidence: item.evidence ?? null, id: item.id ?? `item-${index}`, status: item.status ?? 'unchecked',
  })) });
}

test('the real docs/07 checklist and docs/25 manifest currently agree with no drift', () => {
  const runbookMarkdown = readFileSync('docs/07-administrator-and-operations-runbook.md', 'utf8');
  const checklistJsonText = readFileSync('docs/25-release-readiness-checklist.json', 'utf8');
  assert.deepEqual(validateChecklist(runbookMarkdown, checklistJsonText), []);
  assert.ok(extractRunbookItems(runbookMarkdown).length >= 5, 'sanity: the real checklist must actually have items');
});

test('an item present in the markdown checklist but missing from the JSON manifest is flagged', () => {
  const errors = validateChecklist(runbook(['First item', 'Second item']), checklist([{ description: 'First item' }]));
  assert.ok(errors.some((error) => /Item count drifted/.test(error)));
  assert.ok(errors.some((error) => /no matching entry/.test(error)));
});

test('reworded item text between the two sources is flagged even when the count matches', () => {
  const errors = validateChecklist(
    runbook(['First item', 'Second item']),
    checklist([{ description: 'First item' }, { description: 'Second item, reworded' }]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /text drifted/);
});

test('a "verified" item with no evidence is rejected -- the checklist must never self-certify', () => {
  const errors = validateChecklist(
    runbook(['First item']),
    checklist([{ description: 'First item', status: 'verified' }]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /never assert readiness without attached evidence/);
});

test('a "verified" item with placeholder-length evidence is rejected', () => {
  const errors = validateChecklist(
    runbook(['First item']),
    checklist([{ description: 'First item', evidence: 'ok', status: 'verified' }]),
  );
  assert.equal(errors.length, 1);
});

test('an "unchecked" item that already carries evidence is rejected as an ambiguous state', () => {
  const errors = validateChecklist(
    runbook(['First item']),
    checklist([{ description: 'First item', evidence: 'some evidence', status: 'unchecked' }]),
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ambiguous in-between state/);
});

test('a genuinely verified item with real evidence passes cleanly', () => {
  const errors = validateChecklist(
    runbook(['First item']),
    checklist([{ description: 'First item', evidence: 'Verified by ops 2026-09-02, deploy SHA abc1234.', status: 'verified' }]),
  );
  assert.deepEqual(errors, []);
});

test('malformed JSON in the manifest is reported, not thrown', () => {
  const errors = validateChecklist(runbook(['First item']), '{not valid json');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /not valid JSON/);
});
