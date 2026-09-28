import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from './lib/observability/sentry-options';

Sentry.init(sentryOptions({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT,
  NODE_ENV: process.env.NODE_ENV,
}));

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
