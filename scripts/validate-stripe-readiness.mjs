import process from 'node:process';

const required = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_MEMBERSHIP_PRODUCT_ID',
  'BASE_URL',
];

const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error('Stripe readiness validation failed: missing ' + missing.join(', '));
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY;
if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(key)) {
  console.error('Stripe readiness validation failed: invalid Stripe secret key shape.');
  process.exit(1);
}

if (!/^https:\/\/[^/]+(?:\/.*)?$/.test(process.env.BASE_URL)) {
  console.error('Stripe readiness validation failed: BASE_URL must be an HTTPS URL.');
  process.exit(1);
}
if (!/^whsec_[A-Za-z0-9]+$/.test(process.env.STRIPE_WEBHOOK_SECRET)) {
  console.error('Stripe readiness validation failed: invalid webhook secret shape.');
  process.exit(1);
}
if (!/^prod_[A-Za-z0-9]+$/.test(process.env.STRIPE_MEMBERSHIP_PRODUCT_ID)) {
  console.error('Stripe readiness validation failed: invalid membership Product ID.');
  process.exit(1);
}

const deploymentMode = process.env.VERCEL_ENV === 'production'
  ? 'live'
  : process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development'
    ? 'test'
    : process.env.NODE_ENV === 'production' ? 'live' : 'test';
const keyMode = key.includes('_live_') ? 'live' : 'test';
if (keyMode !== deploymentMode) {
  console.error('Stripe readiness validation failed: Stripe key mode does not match deployment mode.');
  process.exit(1);
}
if (process.env.STRIPE_E2E_ENABLED === 'true' && keyMode !== 'test') {
  console.error('Stripe E2E validation failed: browser verification must use Stripe test mode.');
  process.exit(1);
}

console.log('Stripe configuration is internally complete (' + keyMode + ' mode).');
