import { sanitizeSentryEvent } from './sentry-privacy.ts';

export function sentryEnvironment(environment: NodeJS.ProcessEnv = process.env): string {
  if (environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT) return environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  if (environment.VERCEL_ENV === 'production') return 'production';
  if (environment.VERCEL_ENV === 'preview' && environment.VERCEL_GIT_COMMIT_REF === 'staging') return 'staging';
  return environment.VERCEL_ENV ?? environment.NODE_ENV ?? 'development';
}

export function sentryOptions(environment: NodeJS.ProcessEnv = process.env) {
  return {
    beforeSend: sanitizeSentryEvent,
    dsn: environment.NEXT_PUBLIC_SENTRY_DSN,
    enabled: Boolean(environment.NEXT_PUBLIC_SENTRY_DSN),
    environment: sentryEnvironment(environment),
    release: environment.VERCEL_GIT_COMMIT_SHA,
    sendDefaultPii: false,
    tracesSampleRate: 0,
  };
}
