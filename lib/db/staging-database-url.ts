/** Fail-closed guard for operator scripts that intentionally target the real staging database.
 *
 * This is deliberately separate from validateTestDatabaseUrl (lib/db/test-database-url.ts), which
 * exists for the opposite case -- an ephemeral, throwaway CI database -- and explicitly REJECTS any
 * URL naming a Render host. Staging is a real, persistent Render Postgres instance, and it
 * deliberately shares the same database as production (docs/07-administrator-and-operations-runbook.md
 * "Branch, environment, and deployment workflow"), so STAGING_POSTGRES_URL and POSTGRES_URL are
 * expected to be identical -- that is not a mistake to guard against. The reliable boundary here is
 * the operator's own explicit confirmation, plus requiring a well-formed, explicitly-supplied URL.
 */
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
