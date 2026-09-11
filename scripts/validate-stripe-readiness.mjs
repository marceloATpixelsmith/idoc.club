import process from 'node:process';

const required = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_MEMBERSHIP_PRODUCT_ID',
  'STRIPE_MEMBERSHIP_PRICE_ID',
  'STRIPE_MEMBERSHIP_ONE_TIME_PRICE_ID',
  'BASE_URL',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error('Stripe readiness validation failed: missing ' + missing.join(', '));
  process.exit(1);
}

if (!/^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY)) {
  console.error('Stripe readiness validation failed: invalid Stripe secret key.');
  process.exit(1);
}

const mode = process.env.STRIPE_SECRET_KEY.startsWith('sk_test_') ? 'test' : 'live';
if (process.env.NODE_ENV === 'production' && mode !== 'live') {
  console.error('Stripe readiness validation failed: production requires a live Stripe secret key.');
  process.exit(1);
}
if (process.env.STRIPE_E2E_ENABLED === 'true' && mode !== 'test') {
  console.error('Stripe E2E validation failed: browser verification must use Stripe test mode.');
  process.exit(1);
}

console.log('Stripe configuration is internally complete (' + mode + ' mode).');
