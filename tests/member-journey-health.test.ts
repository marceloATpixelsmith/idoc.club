import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('member journey dashboard requires admin authorization and covers legacy first login, onboarding and renewal', () => {
  const source = read('lib/notifications/member-journey-health.ts');
  for (const identifier of [
    'activation_repeated', 'activation_delivery_stuck', 'login_code_repeated',
    'onboarding_incomplete', 'renewal_delivery_stuck', 'renewal_followup',
  ]) assert.ok(source.includes(identifier), `Missing journey signal ${identifier}`);
  assert.match(source, /requireAdministrator\(actor\)/);
  assert.match(source, /u\.account_state in \('migrated_pending','active','onboarding'\)/);
  assert.match(source, /not exists \([\s\S]*?auth_sessions s[\s\S]*?s\.authenticated_at >= a\.first_at/);
  assert.match(source, /p\.legacy_wp_user_id is not null/);
  assert.match(source, /account_delivery_outbox/);
  assert.match(source, /notification_outbox/);
  assert.match(source, /payments pay/);
  const admin = read('app/(dashboard)/admin/page.tsx');
  assert.match(admin, /getMemberJourneyConcerns\(\)/);
  assert.match(admin, /Member journey health/);
});

test('daily member journey digest uses existing admin recipient queue and avoids five-minute alert floods', () => {
  const watch = read('lib/notifications/member-journey-watch.ts');
  const queue = read('lib/notifications/operational-alert-delivery.ts');
  const cron = read('app/api/cron/email-delivery-watch/route.ts');
  const sql = read('lib/db/migrations/0089_member_journey_alert_kind.sql');
  assert.match(watch, /memberCommunicationsDisabled\(\)/);
  assert.match(watch, /member-journey-digest:\$\{now\.toISOString\(\)\.slice\(0, 10\)\}/);
  assert.match(watch, /enqueueOperationalAlert/);
  assert.match(watch, /kind: 'member_journey_attention'/);
  assert.match(queue, /process\.env\.IDOC_ADMIN_NOTIFICATION_EMAIL/);
  assert.match(cron, /runMemberJourneyWatch\(\)/);
  assert.match(cron, /catch \{ await logError\('member_journey_watch_failed'\); \}/);
  assert.match(sql, /member_journey_attention/);
  assert.doesNotMatch(watch, /sendTransactionalEmail\(/);
});
