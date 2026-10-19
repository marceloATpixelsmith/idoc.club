import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// Site-wide floor: no rendered text is smaller than 13px (0.8125rem). Transactional email
// templates are outside this rule.
const MIN_PX = 13;
const ROOTS = ['app', 'components', 'packages/pixelsmith'];
const EXTENSIONS = /\.(css|tsx)$/;
const SKIPPED = new Set(['node_modules', 'dist', '.next']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIPPED.has(name)) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return EXTENSIONS.test(name) ? [path] : [];
  });
}

const toPx = (value: number, unit: string) => (unit === 'rem' ? value * 16 : value);

// Matches `font-size: 12px`, `text-[12px]`, and `text-[0.75rem]` literals (not relative em/% or clamp()).
const SIZE = /(?:font-size:\s*|text-\[)(\d*\.?\d+)(px|rem)\b/g;

test('no hard-coded text size is below the 13px site-wide floor', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const path of files(root)) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(SIZE)) {
        if (toPx(Number(match[1]), match[2]) < MIN_PX) offenders.push(`${path}: ${match[0]}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('the shared Tailwind text steps stay at or above the floor', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  for (const step of ['xs', 'sm']) {
    const match = css.match(new RegExp(`--text-${step}:\\s*(\\d*\\.?\\d+)rem`));
    assert.ok(match, `--text-${step} is defined`);
    assert.ok(Number(match[1]) * 16 >= MIN_PX);
  }
});

test('rich-text editor sizes and the sanitizer respect the floor', async () => {
  const sizes = readFileSync('components/tiptap/font-size-mark.ts', 'utf8').match(/FONT_SIZES = \[([\d,\s]+)\]/);
  assert.ok(sizes, 'FONT_SIZES is defined');
  assert.ok(Math.min(...sizes[1].split(',').map(Number)) >= MIN_PX);
  const { sanitizeArticleContent } = await import('../lib/news/sanitize.ts');
  assert.match(sanitizeArticleContent('<span style="font-size: 12px">x</span>'), /font-size: 13px/);
});
