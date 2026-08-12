const TEST_DATABASE_NAME = /^(?:idoc_test|idoc_test_[a-z0-9_]+|[a-z0-9_]+_idoc_test)$/;
const PRODUCTION_MARKERS = /(?:^|[._-])(prod|production|live|primary|render)(?:$|[._-])/i;

/** Fail-closed protection shared by every destructive database test entry point. */
export function validateTestDatabaseUrl(value: string | undefined, productionUrl = process.env.POSTGRES_URL): URL {
  if (!value?.trim()) throw new Error('TEST_DATABASE_URL must be explicitly supplied.');
  let candidate: URL;
  try {
    candidate = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(candidate.protocol) || !candidate.hostname || !candidate.username) {
    throw new Error('TEST_DATABASE_URL must be a complete PostgreSQL URL.');
  }
  let databaseName: string;
  try {
    databaseName = decodeURIComponent(candidate.pathname.replace(/^\//, ''));
  } catch {
    throw new Error('TEST_DATABASE_URL database name cannot be decoded safely.');
  }
  if (!databaseName || databaseName.includes('/') || !TEST_DATABASE_NAME.test(databaseName)) {
    throw new Error('Test database name must be idoc_test or use a delimited idoc_test prefix/suffix.');
  }
  const identity = `${candidate.hostname}.${databaseName}`;
  if (PRODUCTION_MARKERS.test(identity) || /contest/i.test(candidate.hostname) || /render/i.test(candidate.hostname)) {
    throw new Error('Production-like database URLs are forbidden.');
  }
  if (productionUrl) {
    const normalizeTarget = (rawUrl: string | URL, label: string) => {
      let url: URL;
      try {
        url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
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
    if (normalizeTarget(candidate, 'TEST_DATABASE_URL') === normalizeTarget(productionUrl, 'POSTGRES_URL')) {
      throw new Error('TEST_DATABASE_URL matches POSTGRES_URL.');
    }
  }
  return candidate;
}
