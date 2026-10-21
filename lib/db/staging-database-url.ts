/** Fail-closed guard for operator scripts that intentionally target the live staging schema.
 *
 * Staging and production use separate schemas in the same Render PostgreSQL database. Live E2E
 * provisioning and cleanup must therefore use the least-privilege idoc_staging_app role, which is
 * granted access only to idoc_staging. Never use the Production role or a schema-owner credential.
 */
export function validateStagingDatabaseUrl(value: string | undefined, confirmed: boolean): URL {
  if (!confirmed) {
    throw new Error(
      'Refusing to run: pass --confirm-staging to acknowledge this command mutates the idoc_staging schema.'
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
  if (decodeURIComponent(candidate.username) !== 'idoc_staging_app') {
    throw new Error('STAGING_POSTGRES_URL must authenticate as idoc_staging_app; refusing any other database role.');
  }
  if (candidate.pathname !== '/ayni_space') {
    throw new Error('STAGING_POSTGRES_URL must target the IDOC database ayni_space.');
  }

  return candidate;
}

/** Every disposable identity created for live auth testing must use this mailbox domain so test
 * teardown tooling cannot be pointed at a real member's account. */
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
