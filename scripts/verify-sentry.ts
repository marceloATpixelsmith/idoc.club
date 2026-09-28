import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '../lib/observability/sentry-options.ts';

if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
  throw new Error('Sentry verification is restricted to a local, non-production process.');
}
if (!process.env.NEXT_PUBLIC_SENTRY_DSN) throw new Error('Set NEXT_PUBLIC_SENTRY_DSN before verification.');

Sentry.init(sentryOptions());
Sentry.captureException(new Error('IDOC local server Sentry verification'));
const delivered = await Sentry.flush(5000);
if (!delivered) throw new Error('Sentry did not confirm delivery before the timeout.');
console.log('Sentry accepted the local server verification event.');
