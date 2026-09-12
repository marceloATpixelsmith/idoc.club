const STRIPE_KEY = /^(?:sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/;
const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9]{16,}$/;
const PRODUCT_ID = /^prod_[A-Za-z0-9_-]{8,}$/;

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Invalid Stripe configuration: ${name}.`);
  return value;
}

export function stripeDeploymentMode(environment = process.env) {
  if (environment.VERCEL_ENV === 'production') return 'live';
  if (environment.VERCEL_ENV === 'preview' || environment.VERCEL_ENV === 'development') return 'test';
  return environment.NODE_ENV === 'production' ? 'live' : 'test';
}

export function validateStripeKey(environment = process.env, { browserVerification = false } = {}) {
  const value = required(environment, 'STRIPE_SECRET_KEY');
  const match = value.match(STRIPE_KEY);
  if (!match) throw new Error('Invalid Stripe configuration: STRIPE_SECRET_KEY shape.');
  const mode = match[1];
  if (browserVerification && mode !== 'test') {
    throw new Error('Invalid Stripe configuration: browser verification requires test mode.');
  }
  if (!browserVerification && mode !== stripeDeploymentMode(environment)) {
    throw new Error('Invalid Stripe configuration: STRIPE_SECRET_KEY mode does not match the deployment.');
  }
  return { mode, value };
}

export function validateStripeWebhookSecret(environment = process.env) {
  const value = required(environment, 'STRIPE_WEBHOOK_SECRET');
  if (!WEBHOOK_SECRET.test(value)) throw new Error('Invalid Stripe configuration: STRIPE_WEBHOOK_SECRET shape.');
  return value;
}

export function validateStripeMembershipProductId(environment = process.env) {
  const value = required(environment, 'STRIPE_MEMBERSHIP_PRODUCT_ID');
  if (!PRODUCT_ID.test(value)) throw new Error('Invalid Stripe configuration: STRIPE_MEMBERSHIP_PRODUCT_ID shape.');
  return value;
}

export function validateStripeBaseUrl(environment = process.env) {
  const value = required(environment, 'BASE_URL');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Invalid Stripe configuration: BASE_URL must be HTTPS.'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error('Invalid Stripe configuration: BASE_URL must be HTTPS.');
  }
  return parsed.toString().replace(/\/$/, '');
}

export function validateStripeReadiness(environment = process.env, options = {}) {
  const key = validateStripeKey(environment, options);
  return {
    baseUrl: validateStripeBaseUrl(environment),
    keyMode: key.mode,
    membershipProductId: validateStripeMembershipProductId(environment),
    webhookSecret: validateStripeWebhookSecret(environment),
  };
}
