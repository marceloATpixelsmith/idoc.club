import { sanitizeSentryEvent } from './sentry-privacy.ts';

export function sentryEnvironment(environment: Partial<NodeJS.ProcessEnv> = process.env): string {
  if (environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT) return environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  if (environment.VERCEL_ENV === 'production') return 'production';
  if (environment.VERCEL_ENV === 'preview' && environment.VERCEL_GIT_COMMIT_REF === 'staging') return 'staging';
  if (environment.VERCEL_ENV) return environment.VERCEL_ENV;
  if (environment.NODE_ENV) return environment.NODE_ENV;
  return 'development';
}

export function sentryOptions(environment: Partial<NodeJS.ProcessEnv> = process.env) {
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
