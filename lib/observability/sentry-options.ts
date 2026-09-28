import { sanitizeSentryEvent } from './sentry-privacy.ts';

export function sentryEnvironment(environment: Partial<NodeJS.ProcessEnv> = process.env): string {
  if (environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT) return environment.NEXT_PUBLIC_SENTRY_ENVIRONMENT;
  const vercelEnvironment = environment.VERCEL_ENV ?? environment.NEXT_PUBLIC_VERCEL_ENV;
  const gitRef = environment.VERCEL_GIT_COMMIT_REF ?? environment.NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF;
  if (vercelEnvironment === 'production') return 'production';
  if (vercelEnvironment === 'preview' && gitRef === 'staging') return 'staging';
  if (vercelEnvironment) return vercelEnvironment;
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
