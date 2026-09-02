#!/usr/bin/env node
// AUTH-OPERATIONS-010: "Pull-request CI MUST install dependencies and fail on contract validation,
// typecheck, build, or whitespace checks including contract documentation changes." This is the
// whitespace check half: a real, narrow, deploy-time hygiene gate over every git-tracked source file
// this repository actually authors (never node_modules, lockfiles, or other generated output), not a
// full ESLint/Prettier rollout -- introducing a full linter's opinionated rule set across an existing
// codebase is a separate, much larger, and more disruptive decision than closing this specific,
// literal gap. Checks: no trailing whitespace on any line, and every checked file ends with exactly
// one trailing newline (never zero, never several).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const CHECKED_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js', '.jsx', '.md', '.json', '.yml', '.yaml', '.css', '.sql'];
// Generated/vendored content this repository does not hand-author line by line -- a real linter
// would exempt these the same way (via .eslintignore/.prettierignore); enforcing whitespace hygiene
// on drizzle-kit's own generated snapshot JSON or the pnpm lockfile would fight the tool that writes
// them, not this codebase's own authoring discipline.
const EXCLUDED_PREFIXES = ['lib/db/migrations/meta/', 'pnpm-lock.yaml'];
// Released migrations (and their snapshots) are checksum-frozen by tests/migration-immutability.test.ts
// -- this whitespace check must never ask for a byte of them to change, so it excludes exactly the
// path set that immutability contract itself protects, read live from the same source of truth
// rather than a second, driftable hardcoded list.
const RELEASED_MIGRATION_PATHS = (() => {
  try {
    return Object.keys(JSON.parse(readFileSync('lib/db/migrations/released-checksums.json', 'utf8')).files);
  } catch {
    return [];
  }
})();

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
}

function shouldCheck(path) {
  if (!CHECKED_EXTENSIONS.some((extension) => path.endsWith(extension))) return false;
  if (RELEASED_MIGRATION_PATHS.includes(path)) return false;
  return !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function violations(path) {
  const content = readFileSync(path, 'utf8');
  if (content.length === 0) return [];
  const found = [];
  const lines = content.split('\n');
  lines.forEach((line, index) => {
    if (/[ \t]+$/.test(line) && !(index === lines.length - 1 && line === '')) {
      found.push(`${path}:${index + 1}: trailing whitespace`);
    }
  });
  if (!content.endsWith('\n')) found.push(`${path}: missing trailing newline`);
  else if (content.endsWith('\n\n')) found.push(`${path}: multiple trailing newlines`);
  return found;
}

export function checkWhitespace(paths = trackedFiles()) {
  return paths.filter(shouldCheck).flatMap(violations);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const found = checkWhitespace();
  if (found.length > 0) {
    console.error(`Whitespace check failed (${found.length} issue${found.length === 1 ? '' : 's'}):`);
    for (const line of found) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`Whitespace check passed: ${trackedFiles().filter(shouldCheck).length} files checked.`);
}
