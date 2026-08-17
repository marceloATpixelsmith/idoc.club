import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const preloader = path.join(root, 'tests/fixtures/deny-network.cjs');
const sensitiveNames = ['POSTGRES_URL', 'AUTH_SECRET', 'ACCOUNT_DELIVERY_ENCRYPTION_KEYS', 'ACCOUNT_DELIVERY_KEY_VERSION', 'RATE_LIMIT_HASH_KEY', 'CRON_SECRET', 'MAILCHIMP_TRANSACTIONAL_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'];
const sentinelValues = sensitiveNames.map((name, index) => `IDOC_SENTINEL_${index}_${'z'.repeat(40)}`);

function filesBelow(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

test('real production build prerenders without DNS, TCP, HTTP, database, Stripe, or email access', { timeout: 180_000 }, () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'idoc-build-boundary-'));
  const marker = path.join(temporary, 'network-attempts.txt');
  const outputDirectory = path.join(root, '.next');
  const priorOutput = path.join(root, `.next-boundary-prior-${process.pid}`);
  if (existsSync(outputDirectory)) renameSync(outputDirectory, priorOutput);
  const environment: NodeJS.ProcessEnv = { ...process.env, IDOC_ALLOW_BUILD_IPC: '1', NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production', NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${preloader}`.trim(), IDOC_NETWORK_ATTEMPT_FILE: marker };
  sensitiveNames.forEach((name, index) => { environment[name] = sentinelValues[index]; });
  delete environment.POSTGRES_URL;
  delete environment.STRIPE_SECRET_KEY;
  delete environment.AUTH_SECRET;
  const result = spawnSync('pnpm', ['exec', 'next', 'build'], { cwd: root, encoding: 'utf8', env: environment, timeout: 170_000 });
  const output = `${result.stdout}\n${result.stderr}`.replaceAll(/\u001b\[[0-9;]*m/g, '');
  try {
    assert.equal(result.status, 0, `Production build failed without privileged configuration:\n${output.slice(-4000)}`);
    assert.equal(existsSync(marker), false, 'Production build attempted network access.');
    assert.match(output, /Generating static pages/);
    for (const route of ['/', '/_not-found', '/pricing', '/recover-password', '/request-activation', '/sign-in', '/sign-up']) assert.match(output, new RegExp(`◐ ${route.replace('/', '\\/')}(?:\\s|$)`));
    for (const route of ['/activate', '/admin', '/admin/exports', '/admin/members', '/admin/notifications', '/admin/payments', '/admin/reconciliation', '/api/admin/export/audit-log', '/api/admin/export/members', '/api/admin/export/notifications', '/api/admin/export/payments', '/api/cron/account-delivery', '/api/cron/reconciliation-scan', '/api/stripe/checkout', '/api/stripe/webhook', '/api/team', '/api/user', '/dashboard', '/dashboard/payments', '/dashboard/profile', '/onboarding', '/reset-password', '/verify-email']) assert.match(output, new RegExp(`ƒ ${route.replaceAll('/', '\\/')}(?:\\s|$)`));
    const browserVisible = [...filesBelow(path.join(outputDirectory, 'static')), ...filesBelow(path.join(outputDirectory, 'server/app')).filter((file) => /\.(?:html|rsc)$/.test(file))];
    assert.ok(browserVisible.length > 0, 'No browser-visible build output was discovered.');
    for (const file of browserVisible) {
      const content = readFileSync(file, 'utf8');
      for (const value of sentinelValues) assert.doesNotMatch(content, new RegExp(value), `Secret value leaked into ${path.relative(root, file)}`);
      for (const name of sensitiveNames) assert.doesNotMatch(content, new RegExp(name), `Privileged environment name leaked into ${path.relative(root, file)}`);
    }
  } finally {
    rmSync(outputDirectory, { force: true, recursive: true });
    if (existsSync(priorOutput)) renameSync(priorOutput, outputDirectory);
  }
});

test('network interception fails closed, redacts destinations, and preserves prior artifacts', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'idoc-denied-network-'));
  const marker = path.join(temporary, 'attempts.txt');
  const artifact = path.join(temporary, 'prior-success.txt');
  writeFileSync(artifact, 'prior-success');
  const result = spawnSync(process.execPath, ['-e', "require('node:dns').lookup('credential.example.invalid',()=>{})"], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: `--require=${preloader}`, IDOC_NETWORK_ATTEMPT_FILE: marker } });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(marker, 'utf8'), 'dns.lookup\n');
  assert.equal(readFileSync(artifact, 'utf8'), 'prior-success');
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /credential\.example\.invalid/);
  assert.match(`${result.stdout}${result.stderr}`, /BUILD_NETWORK_ACCESS_DENIED:dns\.lookup/);
});

test('production modules contain server-only boundaries and no fake credential fallbacks', () => {
  const privileged = ['lib/db/drizzle.ts', 'lib/auth/session.ts', 'lib/payments/stripe.ts', 'lib/payments/manual-payments.ts', 'lib/payments/reconciliation-scan.ts', 'lib/security/encrypted-payload.ts', 'lib/notifications/account-delivery.ts', 'lib/notifications/mailchimp-transactional.ts', 'lib/notifications/profile-change-delivery.ts', 'lib/notifications/renewal-notices.ts', 'lib/membership/status-actions.ts', 'lib/membership/role-grants.ts', 'lib/membership/exports.ts', 'lib/runtime/configuration.ts', 'app/api/cron/account-delivery/route.ts', 'app/api/cron/reconciliation-scan/route.ts', 'app/api/cron/renewal-notice-scan/route.ts', 'app/api/cron/renewal-notice-delivery/route.ts', 'app/api/admin/export/members/route.ts', 'app/api/admin/export/payments/route.ts', 'app/api/admin/export/audit-log/route.ts', 'app/api/admin/export/notifications/route.ts'];
  for (const file of privileged) assert.match(readFileSync(path.join(root, file), 'utf8'), /import 'server-only'/, `${file} lacks the server-only boundary`);
  const productionFiles = [...filesBelow(path.join(root, 'app')), ...filesBelow(path.join(root, 'lib'))].filter((file) => /\.(?:ts|tsx|js|mjs)$/.test(file) && !file.endsWith('setup.ts'));
  const rules = [
    ['hard-coded database URL', /postgres(?:ql)?:\/\/[A-Za-z0-9]/i],
    ['credential fallback', /(?:\?\?|\|\|)\s*['"`](?:test|example|placeholder|dummy|changeme|secret|development|admin123|http:\/\/localhost)/i],
    ['fake provider credential', /['"`](?:sk_(?:test|live)|whsec_)[A-Za-z0-9_-]*?(?:fake|dummy|placeholder|test)/i],
    ['default password', /(?:const|let|var)\s+\w*(?:password|secret)\w*\s*=\s*['"`][^'"`\n]+['"`]/i],
  ] as const;
  const violations: string[] = [];
  for (const file of productionFiles) {
    const source = readFileSync(file, 'utf8');
    for (const [category, pattern] of rules) if (pattern.test(source)) violations.push(`${path.relative(root, file)}: ${category}`);
  }
  assert.deepEqual(violations, []);
});

test('local and CI Release 1 gates are fail-fast and contain every required boundary', () => {
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
  assert.equal(scripts.check, 'pnpm typecheck && pnpm test');
  assert.equal(scripts['check:release1'], 'pnpm check && pnpm test:integration-db && pnpm test:build-boundary && pnpm build');
  const workflow = readFileSync(path.join(root, '.github/workflows/release-1-verification.yml'), 'utf8');
  assert.match(workflow, /image: postgres:16-alpine/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/);
  assert.match(workflow, /run: pnpm check:release1/);
  const marker = path.join(mkdtempSync(path.join(tmpdir(), 'idoc-gate-failure-')), 'should-not-exist');
  const failure = spawnSync('sh', ['-c', `false && touch "${marker}"`]);
  assert.notEqual(failure.status, 0);
  assert.equal(existsSync(marker), false);
});

test('database CLI entry points preserve server-only import conditions and explicit seed credentials', () => {
  const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
  for (const name of ['db:generate', 'db:migrate', 'db:studio', 'db:seed']) {
    assert.match(scripts[name], /--conditions=react-server/, `${name} does not enable the server-only condition`);
  }
  const setup = readFileSync(path.join(root, 'lib/db/setup.ts'), 'utf8');
  assert.match(setup, /SEED_ADMIN_EMAIL/);
  assert.match(setup, /SEED_ADMIN_PASSWORD/);
  assert.doesNotMatch(setup, /admin123|test@test\.com/);
});
