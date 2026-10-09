import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const footer = readFileSync('components/site/Footer.tsx', 'utf8');
const membership = readFileSync('app/(dashboard)/dashboard/membership/page.tsx', 'utf8');
const globals = readFileSync('app/globals.css', 'utf8');
const layout = readFileSync('app/layout.tsx', 'utf8');
const notice = readFileSync('components/site/privacy-notice.tsx', 'utf8');
const privacy = readFileSync('app/privacy/page.tsx', 'utf8');

test('footer omits Facebook and exposes privacy and terms links', () => {
  assert.doesNotMatch(footer, /facebook\.com/i);
  assert.doesNotMatch(footer, />\s*Facebook\s*</i);
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
});

test('Judge and Steward membership displays use the approved role icons', () => {
  assert.match(membership, /import \{ Bell, Stethoscope \} from 'lucide-react'/);
  assert.match(membership, /HorseshoeIcon/);
  assert.doesNotMatch(membership, /\bGavel\b|\bFlag\b/);
  assert.match(membership, /types\.has\('judge'\)[\s\S]*?<Bell /);
  assert.match(membership, /types\.has\('steward'\)[\s\S]*?<HorseshoeIcon /);
});

test('the smallest shared Tailwind type steps are raised sitewide', () => {
  assert.match(globals, /--text-xs: 0\.8125rem;/);
  assert.match(globals, /--text-sm: 0\.9375rem;/);
  assert.match(globals, /@utility eyebrow[\s\S]*?font-size: 0\.8125rem;/);
});

test('the compact essential-cookie notice is mounted sitewide without pretending consent is required', () => {
  assert.match(layout, /<PrivacyNotice \/>/);
  assert.match(notice, /We do not currently use advertising or optional analytics cookies\./);
  assert.match(notice, /window\.localStorage\.setItem/);
  assert.match(notice, /href="\/privacy"/);
  assert.doesNotMatch(notice, /Accept all|Reject all|Allow analytics/);
  assert.match(privacy, /IDOC does not currently use non-essential analytics or advertising cookies\./);
});
