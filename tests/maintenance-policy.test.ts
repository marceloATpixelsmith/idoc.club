import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { maintenanceDecision } from '../lib/runtime/maintenance-policy.ts';

test('static files, the maintenance page, health and sign-in stay reachable', () => {
  for (const path of ['/idoc-logo-white.svg', '/documents/a.pdf', '/api/health', '/sign-in', '/sign-in/', '/mfa', '/api/auth/google/callback', '/api/auth/session-expired']) {
    assert.equal(maintenanceDecision(path, 'GET'), 'allow', path);
  }
  assert.equal(maintenanceDecision('/sign-in', 'POST'), 'allow');
});

test('pages get the branded page and everything that can write gets a JSON 503', () => {
  assert.equal(maintenanceDecision('/', 'GET'), 'page');
  assert.equal(maintenanceDecision('/dashboard/membership', 'HEAD'), 'page');
  assert.equal(maintenanceDecision('/dashboard/membership', 'POST'), 'api');
  for (const path of ['/api/stripe/webhook', '/api/cron/account-delivery', '/api/qstash/jobs', '/api/stripe/checkout']) {
    assert.equal(maintenanceDecision(path, 'POST'), 'api', path);
    assert.equal(maintenanceDecision(path, 'GET'), 'api', path);
  }
});

test('look-alike paths are not allow-listed', () => {
  for (const path of ['/sign-in-evil', '/mfa-bypass', '/maintenance', '/api/healthz', '/api/auth/google-evil']) {
    assert.notEqual(maintenanceDecision(path, 'GET'), 'allow', path);
  }
});

test('middleware gates on the flag only after the cheap path check, lets only a Super Admin session through and fails open', () => {
  const middleware = readFileSync('middleware.ts', 'utf8');
  assert.match(middleware, /maintenance !== 'allow' && await maintenanceModeEnabled\(\)/);
  assert.match(middleware, /sessionIsActiveSuperAdmin\(parsedForMaintenance\)/);
  assert.match(readFileSync('lib/admin/maintenance-mode.ts', 'utf8'), /sessionVersionIsCurrent[\s\S]*authenticatedAt[\s\S]*absoluteExpiresAt[\s\S]*userIsSuperAdmin/); // same checks as getSession()
  assert.match(middleware, /status: 503/);
  assert.match(middleware, /'Retry-After'/);
  const module = readFileSync('lib/admin/maintenance-mode.ts', 'utf8');
  assert.match(module, /catch \{\s*cached = \{ enabled: false/); // an unreadable flag never locks the site
  assert.match(module, /admin\.maintenance_mode\.enabled/);
  const page = readFileSync('lib/runtime/maintenance-page.ts', 'utf8');
  assert.doesNotMatch(page, /^import /m); // renders with no database or session reads
  assert.match(page, /We&rsquo;ll be right back/);
  assert.match(page, /font-size:4\.5rem/); // large type
});
