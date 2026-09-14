import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = new URL('../', import.meta.url);
const manifestUrl = process.argv[2] ? pathToFileURL(process.argv[2]) : new URL('docs/27-stripe-payment-acceptance-gate.json', ROOT);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const errors = [];
const sources = new Map();

function failure(requirement, scenario, missing, expected) {
  errors.push(`requirement=${requirement.id} scenario=${scenario.id} test=${scenario.test?.path ?? '<none>'} missing=${missing}; expected=${expected}`);
}

async function sourceFor(path) {
  if (sources.has(path)) return sources.get(path);
  try {
    const source = await readFile(new URL(path, ROOT), 'utf8');
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const value = { ast, source };
    sources.set(path, value);
    return value;
  } catch {
    return null;
  }
}

function executableTests(ast) {
  const found = new Map();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['test', 'it'].includes(node.expression.text) &&
      node.arguments.length >= 2 && ts.isStringLiteralLike(node.arguments[0]) &&
      (ts.isArrowFunction(node.arguments[1]) || ts.isFunctionExpression(node.arguments[1]))) {
      const body = node.arguments[1].body.getText(ast);
      found.set(node.arguments[0].text, body);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

if (manifest.version !== 2 || !Array.isArray(manifest.requirements)) errors.push('requirement=<manifest> scenario=<schema> test=docs/27-stripe-payment-acceptance-gate.json missing=version 2 scenario map; expected=explicit requirement IDs, scenario IDs, execution classes, named tests, and evidence anchors');
const requirementIds = new Set();
const scenarioIds = new Set();
for (const requirement of manifest.requirements ?? []) {
  if (!requirement.id || requirementIds.has(requirement.id)) errors.push(`requirement=${requirement.id ?? '<none>'} scenario=<schema> test=<none> missing=unique requirement ID; expected=a unique stable requirement ID`);
  requirementIds.add(requirement.id);
  if (!Array.isArray(requirement.scenarios) || requirement.scenarios.length === 0) errors.push(`requirement=${requirement.id} scenario=<none> test=<none> missing=scenario mapping; expected=one or more explicit executable scenarios`);
  for (const scenario of requirement.scenarios ?? []) {
    if (!scenario.id || scenarioIds.has(scenario.id)) failure(requirement, scenario, 'unique scenario ID', 'a globally unique stable scenario ID');
    scenarioIds.add(scenario.id);
    if (!['local', 'stripe-test-mode'].includes(scenario.execution)) failure(requirement, scenario, 'valid automated execution class', 'local or stripe-test-mode; manual-only belongs in manualOnly');
    if (!scenario.test?.path || !scenario.test?.name) { failure(requirement, scenario, 'named test mapping', 'an exact test path and exact executable test title'); continue; }
    const parsed = await sourceFor(scenario.test.path);
    if (!parsed) { failure(requirement, scenario, 'mapped test file', 'an existing TypeScript test file'); continue; }
    if (/\b(?:test|it|describe)\s*\.\s*(?:skip|fixme)|\b(?:TODO|FIXME|placeholder)\b/i.test(parsed.source)) failure(requirement, scenario, 'enabled non-placeholder test', 'no skip, fixme, disabled, TODO, FIXME, or placeholder markers');
    const tests = executableTests(parsed.ast);
    const body = tests.get(scenario.test.name);
    if (!body) { failure(requirement, scenario, 'exact named executable test', `test('${scenario.test.name}', ...)`); continue; }
    if (!/\b(?:expect\s*\(|assert\s*\.\s*[a-zA-Z]+\s*\()/.test(body)) failure(requirement, scenario, 'behavioral assertion', 'at least one assertion inside this exact test body');
    for (const evidence of scenario.evidence ?? []) if (!body.includes(evidence)) failure(requirement, scenario, `behavior anchor ${JSON.stringify(evidence)}`, 'the named test must directly exercise and assert this scenario-specific behavior');
    if (scenario.execution === 'stripe-test-mode') {
      if (!parsed.source.includes('new Stripe(')) failure(requirement, scenario, 'real Stripe SDK client', 'instantiate the installed Stripe client in the provider spec');
      if (!parsed.source.includes('livemode') || !parsed.source.includes('toBe(false)')) failure(requirement, scenario, 'test-mode proof', 'the provider spec must contain an executable livemode=false assertion');
      if (/fakeStripe|mockStripe|testStripeClient/.test(body)) failure(requirement, scenario, 'provider-backed implementation', 'use Stripe test-mode API objects, not a fake provider');
    }
  }
}
for (const item of manifest.manualOnly ?? []) {
  if (!item.id?.startsWith('MANUAL-') || typeof item.reason !== 'string' || item.reason.length < 60) errors.push(`requirement=<manual> scenario=${item.id ?? '<none>'} test=<none> missing=manual evidence boundary; expected=MANUAL-* ID and a specific external-account reason`);
  if (item.test || item.execution) errors.push(`requirement=<manual> scenario=${item.id} test=${item.test?.path ?? '<none>'} missing=manual-only separation; expected=no automated test mapping or execution class`);
}
for (const required of ['SEMINAR-CHECKOUT-PROVIDER', 'SEMINAR-WEBHOOK-INTEGRITY', 'SEMINAR-REFUND-PROVIDER', 'BROWSER-DOUBLE-CLICK', 'BROWSER-EXPIRED-SESSION', 'BROWSER-CSRF-FAILURE', 'BROWSER-UNAUTHORIZED-MEMBER', 'BROWSER-ADMIN-RECONCILIATION']) {
  if (!scenarioIds.has(required)) errors.push(`requirement=<coverage> scenario=${required} test=<none> missing=mandatory scenario; expected=an explicit named executable scenario mapping`);
}
if (errors.length) {
  console.error(['Stripe acceptance scenario validation failed:', ...errors.map((error) => `- ${error}`)].join('\n'));
  process.exit(1);
}
console.log(`Stripe acceptance scenario inventory is valid: ${requirementIds.size} requirements and ${scenarioIds.size} named executable scenarios. This validates traceability, not test execution or provider evidence.`);
