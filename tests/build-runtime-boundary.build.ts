import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = process.cwd();
const preloader = path.join(root, 'tests/fixtures/deny-network.cjs');
// AUTH-SECRET-001: "Provider client secrets MUST be server-only... excluded from browser bundles,
// portable JSON, logs and errors." GOOGLE_OAUTH_CLIENT_SECRET is included here alongside IDOC's own
// self-generated secrets so the same real-build scan below (not source inspection) proves it too
// never reaches any browser-visible build output. GOOGLE_OAUTH_CLIENT_ID and
// GOOGLE_OAUTH_REDIRECT_URI are deliberately excluded: neither is a secret (the client ID is
// unavoidably visible to Google and the redirect URI is a public callback URL), so scanning for
// them would only produce false positives.
const sensitiveNames = ['POSTGRES_URL', 'AUTH_SECRET', 'ACCOUNT_DELIVERY_ENCRYPTION_KEYS', 'ACCOUNT_DELIVERY_KEY_VERSION', 'RATE_LIMIT_HASH_KEY', 'CRON_SECRET', 'BREVO_API_KEY', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'GOOGLE_OAUTH_CLIENT_SECRET'];
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
    // Every React page route renders through the single root layout (app/layout.tsx), which
    // synchronously awaits the per-request CSRF cookie (AUTH-CSRF-003) before producing any JSX --
    // deliberately NOT behind a Suspense boundary (see the comment on RootLayout for why: wrapping
    // it broke real HTTP-level authorization redirects). That makes every route, page or Route
    // Handler alike, fully dynamic; none of them get a PPR static shell. This is an accepted,
    // explicit performance tradeoff in favor of guaranteed-correct CSRF/authorization behavior.
    for (const route of ['/', '/_not-found', '/activate', '/admin', '/admin/exports', '/admin/members', '/admin/notifications', '/admin/payments', '/admin/reconciliation', '/dashboard', '/dashboard/profile', '/dashboard/security', '/dashboard/seminars', '/mfa', '/onboarding', '/pricing', '/privacy', '/recover-password', '/request-activation', '/reset-password', '/sign-in', '/sign-up', '/terms', '/verify-email', '/.well-known/security.txt', '/api/address/autocomplete', '/api/admin/export/audit-log', '/api/admin/export/members', '/api/admin/export/notifications', '/api/admin/export/payments', '/api/auth/google/callback', '/api/auth/google/link/start', '/api/auth/google/link/status', '/api/auth/google/start', '/api/client-error', '/api/cron/account-delivery', '/api/cron/data-retention-purge', '/api/cron/reconciliation-scan', '/api/cron/renewal-notice-delivery', '/api/cron/renewal-notice-scan', '/api/health', '/api/brevo/webhook', '/api/stripe/checkout', '/api/stripe/webhook', '/api/team', '/api/user']) assert.match(output, new RegExp(`ƒ ${route.replaceAll('/', '\\/')}(?:\\s|$)`));
    const browserVisible = [...filesBelow(path.join(outputDirectory, 'static')), ...filesBelow(path.join(outputDirectory, 'server/app')).filter((file) => /\.(?:html|rsc)$/.test(file))];
    assert.ok(browserVisible.length > 0, 'No browser-visible build output was discovered.');
    for (const file of browserVisible) {
      const content = readFileSync(file, 'utf8');
      for (const value of sentinelValues) assert.doesNotMatch(content, new RegExp(value), `Secret value leaked into ${path.relative(root, file)}`);
      for (const name of sensitiveNames) assert.doesNotMatch(content, new RegExp(name), `Privileged environment name leaked into ${path.relative(root, file)}`);
      // AUTH-PRIVACY-001: reuses this already-real production build's output (rather than a
      // separate build) to prove no analytics/tracking script reached the actual bundled,
      // browser-visible artifact -- catching anything a transitive dependency might bundle in even
      // if no source file references it directly, which tests/privacy-data-minimization.test.ts's
      // source-tree scan alone cannot.
      assert.doesNotMatch(content, /google-analytics\.com|googletagmanager\.com|mixpanel|amplitude\.com|posthog|hotjar|fullstory|segment\.io|plausible\.io|hubspot/i, `Analytics/tracking reference leaked into build output: ${path.relative(root, file)}`);
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
  const privileged = ['lib/db/drizzle.ts', 'lib/auth/session.ts', 'lib/payments/stripe.ts', 'lib/payments/manual-payments.ts', 'lib/payments/reconciliation-scan.ts', 'lib/security/encrypted-payload.ts', 'lib/notifications/account-delivery.ts', 'lib/notifications/brevo-transactional.ts', 'lib/notifications/profile-change-delivery.ts', 'lib/notifications/renewal-notices.ts', 'lib/membership/status-actions.ts', 'lib/membership/role-grants.ts', 'lib/membership/exports.ts', 'lib/runtime/configuration.ts', 'app/api/cron/account-delivery/route.ts', 'app/api/cron/reconciliation-scan/route.ts', 'app/api/cron/renewal-notice-scan/route.ts', 'app/api/cron/renewal-notice-delivery/route.ts', 'app/api/admin/export/members/route.ts', 'app/api/admin/export/payments/route.ts', 'app/api/admin/export/audit-log/route.ts', 'app/api/admin/export/notifications/route.ts'];
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
  assert.equal(scripts['check:release1'], 'node scripts/validate-auth-docs.mjs && node scripts/validate-release-checklist.mjs && node scripts/validate-toolchain-policy.mjs && node scripts/check-whitespace.mjs && pnpm typecheck && pnpm test:ci && pnpm test:integration-db && pnpm test:build-boundary && pnpm build');
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
