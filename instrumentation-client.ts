import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/observability/sentry-options';
import { startNewRelicBrowser } from './lib/observability/new-relic-browser';

Sentry.init(sentryOptions({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF,
  NODE_ENV: process.env.NODE_ENV,
}));

// Staging-only New Relic Browser monitoring (inert unless configured); see docs/07.
startNewRelicBrowser();

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
