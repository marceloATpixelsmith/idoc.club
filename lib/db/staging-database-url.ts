/** Fail-closed guard for operator scripts that intentionally target the real staging database.
 *
 * This is deliberately separate from validateTestDatabaseUrl (lib/db/test-database-url.ts), which
 * exists for the opposite case -- an ephemeral, throwaway CI database -- and explicitly REJECTS any
 * URL naming a Render host. Staging is a real, persistent Render Postgres instance
 * (docs/07-administrator-and-operations-runbook.md: "Never share the production database/credential
 * with staging"), so staging and production URLs cannot be told apart by shape alone. The only
 * reliable boundary here is the operator's own explicit confirmation, plus refusing to run if the
 * supplied URL happens to equal the known production POSTGRES_URL.
 */
export function validateStagingDatabaseUrl(
  value: string | undefined,
  productionUrl: string | undefined,
  confirmed: boolean,
): URL {
  if (!confirmed) {
    throw new Error(
      'Refusing to run: pass --confirm-staging to acknowledge this command mutates the real staging database.'
    );
  }
  if (!value?.trim()) {
    throw new Error(
      'STAGING_POSTGRES_URL must be explicitly supplied. Never reuse POSTGRES_URL or TEST_DATABASE_URL for this.'
    );
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

  if (productionUrl) {
    const normalize = (raw: string | URL, label: string) => {
      let url: URL;
      try {
        url = raw instanceof URL ? raw : new URL(raw);
      } catch {
        throw new Error(`${label} cannot be compared safely.`);
      }
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
        throw new Error(`${label} cannot be compared safely.`);
      }
      let name: string;
      try {
        name = decodeURIComponent(url.pathname.replace(/^\//, ''));
      } catch {
        throw new Error(`${label} cannot be compared safely.`);
      }
      if (!name || name.includes('/')) throw new Error(`${label} cannot be compared safely.`);
      return `${url.hostname.toLowerCase().replace(/\.$/, '')}:${url.port || '5432'}/${name}`;
    };
    if (normalize(candidate, 'STAGING_POSTGRES_URL') === normalize(productionUrl, 'POSTGRES_URL')) {
      throw new Error('STAGING_POSTGRES_URL matches POSTGRES_URL -- refusing to run against what looks like production.');
    }
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
