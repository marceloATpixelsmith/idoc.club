/** Fail-closed guard for live-auth tooling. The Render database instance is shared, but staging
 * and production are isolated by schema and application role. */
export function validateStagingDatabaseUrl(value: string | undefined, confirmed: boolean): URL {
  if (!confirmed) {
    throw new Error(
      'Refusing to run: pass --confirm-staging to acknowledge this command mutates the real staging database.'
    );
  }
  if (!value?.trim()) {
    throw new Error('STAGING_POSTGRES_URL must be explicitly supplied.');
  }

  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error('STAGING_POSTGRES_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(candidate.protocol) || !candidate.hostname || !candidate.username) {
    throw new Error('STAGING_POSTGRES_URL must be a complete PostgreSQL URL.');
  }
  if (candidate.username !== 'idoc_staging_app' || candidate.pathname !== '/ayni_space') {
    throw new Error('STAGING_POSTGRES_URL must use the idoc_staging_app role and ayni_space database.');
  }
  const optionValues = candidate.searchParams.getAll('options');
  const options = optionValues.join(' ');
  const searchPath = /(?:^|\s)-c\s*search_path=([^\s]+)/.exec(options)?.[1];
  if (searchPath && searchPath !== 'idoc_staging') {
    throw new Error('STAGING_POSTGRES_URL must not override the idoc_staging search path.');
  }
  if (!searchPath) {
    // Vercel's staging URL is scoped to idoc_staging_app; add the schema path explicitly for CI.
    candidate.searchParams.delete('options');
    candidate.searchParams.set('options', [options, '-c search_path=idoc_staging'].filter(Boolean).join(' '));
  }

  const sslModes = candidate.searchParams.getAll('sslmode').map((mode) => mode.toLowerCase());
  const secureSslModes = new Set(['require', 'verify-ca', 'verify-full']);
  if (sslModes.some((mode) => !secureSslModes.has(mode)) || new Set(sslModes).size > 1) {
    throw new Error('STAGING_POSTGRES_URL must use a secure and unambiguous sslmode.');
  }
  if (sslModes.length === 0) {
    // Render requires TLS; postgres.js does not inherit the application's separate connection helper.
    candidate.searchParams.set('sslmode', 'require');
  }

  return candidate;
}

/** Every disposable identity created for live auth testing must use this mailbox domain (the same
 * one the Pixelsmith E2E Email connector provisions), so test-teardown tooling can never be pointed,
 * even by mistake, at a real member's account. */
const DISPOSABLE_TEST_EMAIL = /^[^@\s]+@pixelsmith\.space$/i;

export function requireDisposableTestEmail(email: string | undefined): string {
  const trimmed = email?.trim() ?? '';
  if (!DISPOSABLE_TEST_EMAIL.test(trimmed)) {
    throw new Error(
      `Refusing to operate on "${email ?? ''}": only disposable @pixelsmith.space E2E test addresses are allowed.`
    );
  }
  return trimmed;
}

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export { arg };
