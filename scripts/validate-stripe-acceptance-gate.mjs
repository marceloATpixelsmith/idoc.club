import { readFile } from 'node:fs/promises';
import process from 'node:process';

const ROOT = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('docs/27-stripe-payment-acceptance-gate.json', ROOT), 'utf8'));
const errors = [];
const forbidden = /\b(?:test|it|describe)\s*\.\s*(?:skip|fixme)|\b(?:TODO|FIXME)\b/i;
const realTest = /\b(?:test|it)\s*\(\s*['"`][^'"`]{12,}['"`]/;
const behavioralAssertion = /\b(?:assert\.(?:equal|deepEqual|throws|rejects|match|doesNotMatch)|expect\([^\n]+\)\.(?:toBe|toEqual|toHaveLength|toMatch|toThrow|toContain|toBeTruthy|toBeFalsy|toBeGreaterThan|not\.to))/;

if (!Array.isArray(manifest.requirements) || manifest.requirements.length !== 11) {
  errors.push('The inventory must enumerate exactly eleven automatable requirement groups.');
}

const ids = new Set();
for (const requirement of manifest.requirements ?? []) {
  if (!requirement.id || ids.has(requirement.id)) errors.push(`Invalid or duplicate requirement id: ${requirement.id ?? '<missing>'}.`);
  ids.add(requirement.id);
  if (!Array.isArray(requirement.tests) || requirement.tests.length === 0) errors.push(`${requirement.id}: no tests mapped.`);
  for (const path of requirement.tests ?? []) {
    let source;
    try { source = await readFile(new URL(path, ROOT), 'utf8'); } catch { errors.push(`${requirement.id}: mapped test is absent: ${path}.`); continue; }
    if (forbidden.test(source)) errors.push(`${requirement.id}: ${path} contains skip, fixme, TODO, or FIXME.`);
    if (path.endsWith('.ts') && path !== 'tests/stripe-e2e/global-setup.ts' && !realTest.test(source)) errors.push(`${requirement.id}: ${path} has no named executable test.`);
    if (path !== 'tests/stripe-e2e/global-setup.ts' && !behavioralAssertion.test(source)) errors.push(`${requirement.id}: ${path} has no behavioral assertion.`);
    if (path.includes('stripe-e2e/') && path.endsWith('.spec.ts')) {
      if (!/new Stripe\(/.test(source)) errors.push(`${requirement.id}: ${path} does not inspect Stripe provider objects.`);
      if (!/livemode/.test(source)) errors.push(`${requirement.id}: ${path} does not prove test mode.`);
    }
  }
}

for (const item of manifest.manualOnly ?? []) {
  if (!item.id || typeof item.reason !== 'string' || item.reason.length < 40 || !/requires/i.test(item.reason)) {
    errors.push(`Manual-only item ${item.id ?? '<missing>'} needs a specific external-account reason.`);
  }
}

if (errors.length) {
  console.error(['Stripe acceptance gate failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
  process.exit(1);
}
console.log(`Stripe acceptance inventory is structurally valid: ${manifest.requirements.length} automatable groups and ${manifest.manualOnly.length} manual-only groups. This is not execution evidence.`);
