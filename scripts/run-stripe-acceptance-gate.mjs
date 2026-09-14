import { spawnSync } from 'node:child_process';
import process from 'node:process';

if (process.env.STRIPE_E2E_ENABLED !== 'true') {
  console.error('Stripe acceptance execution requires STRIPE_E2E_ENABLED=true and disposable provider/application/database prerequisites.');
  process.exit(1);
}

for (const [command, args] of [
  [process.execPath, ['scripts/validate-stripe-acceptance-gate.mjs']],
  ['pnpm', ['test:integration-db']],
  ['pnpm', ['test:stripe-e2e']],
]) {
  const result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Stripe acceptance execution passed against the application, Stripe test mode, and authoritative database.');
