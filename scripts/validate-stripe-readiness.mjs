import process from 'node:process';
import { validateStripeReadiness } from '../lib/runtime/stripe-configuration.mjs';

try {
  const configuration = validateStripeReadiness(process.env, {
    browserVerification: process.env.STRIPE_E2E_ENABLED === 'true',
  });
  console.log(`Stripe configuration is internally complete (${configuration.keyMode} mode).`);
} catch (error) {
  console.error(`Stripe readiness validation failed: ${error instanceof Error ? error.message : 'invalid configuration'}`);
  process.exit(1);
}
