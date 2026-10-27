import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

// app/globals.css gives every plain <button> a gold pill unless it carries a `bg-` class (and base makes it uppercase). A button written
// as a text link (underlined) must opt out, or it renders as a gold blob (docs/29 section 2).

const root = process.cwd();
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === 'node_modules' ? [] : sourceFiles(full);
    return full.endsWith('.tsx') && !full.includes(`${path.sep}components${path.sep}ui${path.sep}`) ? [full] : [];
  });
}

test('every underlined (link-style) button opts out of the default gold pill and uppercase look', () => {
  const offenders: string[] = [];
  for (const file of [...sourceFiles(path.join(root, 'app')), ...sourceFiles(path.join(root, 'components'))]) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<button\b([^>]*?)(?<![=-])>/gs)) {
      const attributes = match[1];
      const className = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(attributes);
      const classes = className ? (className[1] ?? className[2]) : '';
      if (/\bunderline\b/.test(classes) && !/\bbg-/.test(classes)) offenders.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length}`);
      if (/\bunderline\b/.test(classes) && !/\bnormal-case\b/.test(classes)) offenders.push(`${path.relative(root, file)}:${source.slice(0, match.index).split('\n').length} (uppercase)`);
    }
  }
  assert.deepEqual(offenders, [], 'link-style buttons need bg-transparent normal-case tracking-normal');
});
