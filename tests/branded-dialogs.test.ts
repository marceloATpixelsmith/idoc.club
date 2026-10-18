import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (name === 'node_modules' || name.startsWith('.')) return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

test('no browser alert, confirm or prompt box is used anywhere; branded dialogs replace them', () => {
  const offenders: string[] = [];
  for (const file of ['app', 'components', 'lib', 'hooks'].flatMap(sourceFiles)) {
    const source = readFileSync(file, 'utf8');
    if (/\bwindow\.(alert|confirm|prompt)\(/.test(source)) offenders.push(`${file}: window.alert/confirm/prompt`);
    // A bare alert(...)/confirm(...) is fine only when it is the branded hook's own function.
    if (/(?<![.\w])(alert|confirm|prompt)\(/.test(source) && !source.includes('useBrandedDialogs')) offenders.push(`${file}: bare alert/confirm/prompt`);
  }
  assert.deepEqual(offenders, []);
});

test('the branded dialogs use the same dialog primitives as the authenticator prompt', () => {
  const source = readFileSync('components/ui/branded-dialogs.tsx', 'utf8');
  assert.match(source, /from '@\/components\/ui\/dialog'/);
  assert.match(source, /showCloseButton=\{false\}/);
  assert.match(source, /whitespace-pre-line/);
});

test('archiving needs no authenticator code, but permanent deletion still does', () => {
  const actions = readFileSync('app/(dashboard)/admin/bulk-actions.ts', 'utf8');
  const archive = actions.slice(actions.indexOf('export async function bulkArchiveMembers'), actions.indexOf('export type BulkUpdateState'));
  const remove = actions.slice(actions.indexOf('export async function bulkDeleteAdminRows'), actions.indexOf('export async function bulkArchiveMembers'));
  assert.ok(archive.length > 100 && remove.length > 100);
  assert.doesNotMatch(archive, /requireFreshStepUp/);
  assert.match(archive, /requireCsrfToken/);
  assert.match(archive, /requireAdministrator/);
  assert.match(remove, /requireFreshStepUp/);
  assert.doesNotMatch(readFileSync('components/admin/bulk-archive-members.tsx', 'utf8'), /useFreshStepUpAction/);
  assert.match(readFileSync('components/admin/bulk-delete-selected.tsx', 'utf8'), /useFreshStepUpAction/);
  // News/Blog archiving (status change) has never asked for one and must not start to.
  for (const file of ['app/(dashboard)/admin/news/actions.ts', 'lib/news/articles.ts']) {
    assert.doesNotMatch(readFileSync(file, 'utf8'), /requireFreshStepUp/, file);
  }
  const bulkStatus = actions.slice(actions.indexOf('export async function bulkSetNewsStatus'));
  assert.doesNotMatch(bulkStatus.slice(0, bulkStatus.indexOf('\nexport async function', 10) > 0 ? bulkStatus.indexOf('\nexport async function', 10) : undefined), /requireFreshStepUp/);
});
